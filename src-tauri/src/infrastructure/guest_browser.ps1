# 由提权后的 Hyper-V 控制器执行，浏览器配置数据保存在虚拟机内。
# CONSOLE_DISPLAY
function Find-GuestConsole([string]$VmId) {
    $sessionId = (Get-Process -Id $PID).SessionId
    $target = '(?i)(?:^|\s)-G\s+"?\{?' + [regex]::Escape($VmId) + '\}?"?(?:\s|$)'
    foreach ($candidate in @(Get-CimInstance Win32_Process -Filter "Name='vmconnect.exe'")) {
        if ($candidate.SessionId -ne $sessionId -or $candidate.CommandLine -notmatch $target) { continue }
        $window = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
        if ($window -and $window.MainWindowHandle -ne 0) { return $window.Id }
    }
    return $null
}
function Show-GuestConsole([int]$ProcessId) {
    if (!('CodeSeam.ConsoleWindow' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CodeSeam {
    public static class ConsoleWindow {
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    }
}
'@
    }
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    $handle = $process.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) { throw '虚拟机连接窗口已关闭，请重试。' }
    # 最小化窗口仍会返回 MainWindowHandle，因此仅获取窗口句柄不足以将其打开。
    # 仅恢复最小化窗口，保留已最大化或全屏的窗口状态。
    $command = if ([CodeSeam.ConsoleWindow]::IsIconic($handle)) { 9 } else { 5 }
    $null = [CodeSeam.ConsoleWindow]::ShowWindowAsync($handle, $command)
    # 将窗口置顶时保留其位置和大小，避免阻塞 VMConnect 界面线程。
    $null = [CodeSeam.ConsoleWindow]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, 0, 0, 0x4043)
    $null = [CodeSeam.ConsoleWindow]::SetForegroundWindow($handle)
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
        if ([CodeSeam.ConsoleWindow]::IsWindowVisible($handle) -and ![CodeSeam.ConsoleWindow]::IsIconic($handle)) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw '虚拟机连接窗口未能恢复显示，请在任务栏选择“虚拟机连接”后重试。'
}
function Open-GuestConsole([string]$VmId, [int]$TimeoutSeconds = 20) {
    $existing = Find-GuestConsole $VmId
    if ($existing) { Show-GuestConsole $existing; return $existing }
    $connection = Join-Path $env:SystemRoot 'System32\vmconnect.exe'
    if (!(Test-Path -LiteralPath $connection -PathType Leaf)) { throw '未找到 Hyper-V 虚拟机连接窗口，请安装 Hyper-V 管理工具后重试。' }
    Set-GuestConsoleDisplay $VmId
    # 由交互计划任务启动，使窗口脱离检测作业；检测返回或应用关闭不应杀掉窗口。
    $taskName = 'CodeSeam-Console-' + [guid]::NewGuid().ToString('N')
    $consoleAction = New-ScheduledTaskAction -Execute $connection -Argument ('localhost -G ' + $VmId)
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    try {
        Register-ScheduledTask -TaskName $taskName -Action $consoleAction -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null
        $requestedAt = [DateTime]::UtcNow.AddSeconds(-1)
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        do {
            $window = Find-GuestConsole $VmId
            if ($window) { Show-GuestConsole $window; return $window }
            $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
            $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
            if ($task.State -ne 'Running' -and $info.LastRunTime.ToUniversalTime() -ge $requestedAt -and $info.LastTaskResult -ne 0 -and $info.LastTaskResult -ne 267009) {
                throw ('虚拟机窗口启动失败，任务返回：' + $info.LastTaskResult)
            }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $deadline)
        throw ('Guest 已就绪，但 ' + $TimeoutSeconds + ' 秒内未检测到目标虚拟机的可见窗口，请重试。')
    } finally {
        # 注销定义不会停止已运行的 VMConnect，也不停止 Guest。
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    }
}
if ($request.action -in @('observe', 'start', 'open_console', 'pause_apps', 'unlock_apps', 'repair_node')) {
    # DAILY_RUNTIME
    return
}
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
if ($record.phase -ne 'guest' -or !$record.deployed) { throw '请先完成 Guest Windows 安装。' }
$progress = Get-Content -LiteralPath (Join-Path $root 'guest-progress.json') -Raw | ConvertFrom-Json
if (!$progress.ready -or $progress.name -ne $record.name) { throw '请返回运行环境完成目标 Guest 初始化后重试。' }
$vm = Get-VM -Id $record.vmId -ErrorAction Stop
if ($vm.State -eq 'Off' -or $vm.State -eq 'Saved') { Start-VM -VM $vm | Out-Null }
elseif ($vm.State -eq 'Paused') { Resume-VM -VM $vm | Out-Null }
elseif ($vm.State -ne 'Running') { throw ('虚拟机正在转换状态：' + $vm.State) }
$credential = Import-Clixml -LiteralPath (Join-Path $root 'guest-credential.xml')
$session = $null
try {
    $deadline = [DateTime]::UtcNow.AddMinutes(2)
    do {
        try { $session = New-PSSession -VMId $record.vmId -Credential $credential -ErrorAction Stop } catch { $session = $null }
        if (!$session) { Start-Sleep -Seconds 3 }
    } while (!$session -and [DateTime]::UtcNow -lt $deadline)
    if (!$session) { throw 'VM 已启动，但 Guest 通道在 120 秒内未就绪，请检查 Windows 启动状态后重试。' }
    if (!(Test-GuestDesktop $session)) { throw 'Windows 首次设置尚未完成或 CodeSeam 桌面未就绪，请先完成 Guest 首次设置。' }
    $node = $request.config.node
    if ($node.id -ne $record.node.id -or $node.exitIp -ne $record.node.exitIp) { throw '当前节点或出口与 Guest 绑定不一致，请先重新配置 Guest 网络。' }
    $target = $request.config.timezoneTarget
    try {
        if ($request.config.action -eq 'verify') {
            $actualTimezone = Invoke-Command -Session $session -ScriptBlock { (Get-TimeZone).Id }
            if ($actualTimezone -ne $target.windowsId) { throw 'Guest 时区已偏离目标，请返回运行环境复验；浏览器验证不会修改系统时区。' }
        } else { $actualTimezone = Sync-GuestTimezone $session $target }
    }
    catch {
        if ($request.config.action -eq 'verify') { throw }
        $progress.ready = $false
        $progress | Add-Member -NotePropertyName error -NotePropertyValue $_.Exception.Message -Force
        if ($progress.tasks -and $progress.tasks.Count -gt 1) { $progress.tasks[1] = @{status='failed';detail=$_.Exception.Message} }
        $failedProgressPath = Join-Path $root 'guest-progress.json'
        $progress | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath ($failedProgressPath + '.tmp') -Encoding UTF8
        Move-Item -LiteralPath ($failedProgressPath + '.tmp') -Destination $failedProgressPath -Force
        throw
    }
    if ($request.config.action -ne 'verify') {
    $record | Add-Member -NotePropertyName timezoneTarget -NotePropertyValue $target -Force
    Save-Checkpoint $record
    $progress | Add-Member -NotePropertyName timezone -NotePropertyValue $actualTimezone -Force
    $progress | Add-Member -NotePropertyName timezoneTarget -NotePropertyValue $target -Force
    $progress | Add-Member -NotePropertyName timezonePolicyVersion -NotePropertyValue 1 -Force
    if ($progress.tasks -and $progress.tasks.Count -gt 1) { $progress.tasks[1] = @{status='satisfied';detail=('Guest 时区：' + $actualTimezone + '（与所选出口一致）')} }
    $progressPath = Join-Path $root 'guest-progress.json'
    $progress | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath ($progressPath + '.tmp') -Encoding UTF8
    Move-Item -LiteralPath ($progressPath + '.tmp') -Destination $progressPath -Force
    }
    if ($request.action -eq 'ensure_ready') {
        Invoke-Command -Session $session -ScriptBlock {
            $setup = Get-ItemProperty HKLM:\SYSTEM\Setup
            if ($setup.SystemSetupInProgress -ne 0 -or $setup.OOBEInProgress -ne 0) { throw 'Guest Windows 首次设置尚未完成。' }
            if ((Get-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop).State -ne 'Running') { throw 'Guest 受管代理未运行，请返回运行环境修复。' }
        }
        $consoleProcessId = $null
        if ($request.config.openConsole -eq $true) {
            $consoleProcessId = Open-GuestConsole (([guid]$record.vmId).ToString())
        }
        @{ ready=$true; state='Running'; name=$record.name; timezone=$actualTimezone; timezoneTarget=$target; consoleOpened=($null -ne $consoleProcessId); consoleProcessId=$consoleProcessId } | ConvertTo-Json -Compress
        return
    }
    Invoke-Command -Session $session -ScriptBlock {
        param($browserScript, $selection, $runtimeId, $node, $worker, $action, $timezoneTarget, $runtimeLocked)
        $setup = Get-ItemProperty HKLM:\SYSTEM\Setup
        if ($setup.SystemSetupInProgress -ne 0 -or $setup.OOBEInProgress -ne 0) { throw 'Guest Windows 首次设置尚未完成。' }
        if ((Get-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop).State -ne 'Running') { throw 'Guest 受管代理未运行，请返回运行环境修复。' }
        if ((Get-NetAdapter -Name 'CodeSeam-TUN' -ErrorAction Stop).Status -ne 'Up') { throw 'Guest 受管 TUN 未就绪，请返回运行环境修复。' }
        if (@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled).Count) { throw 'Guest IPv6 策略已变化，请返回运行环境复检。' }
        $dns = @(Get-NetAdapter | Where-Object Status -eq Up | Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses.Count -gt 0 })
        if (!$dns.Count -or @($dns | Where-Object { $_.ServerAddresses | Where-Object { $_ -ne '198.18.0.2' } }).Count) { throw 'Guest DNS 已偏离受管配置，请返回运行环境修复。' }
        if ((Get-NetFirewallRule -PolicyStore ActiveStore -Name 'CodeSeam-Block-UDP').Enabled -ne 'True' -or @(Get-NetFirewallProfile | Where-Object { !$_.Enabled }).Count) { throw 'Guest UDP 防护未启用，请返回运行环境修复。' }
        # 管理操作以 CodeSeamAgent 运行，浏览器数据归可见桌面的用户所有。
        $desktopUser = Get-LocalUser -Name CodeSeam -ErrorAction Stop
        $profileKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $desktopUser.SID.Value
        $desktopProfile = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $profileKey -ErrorAction Stop).ProfileImagePath)
        $env:LOCALAPPDATA = Join-Path $desktopProfile 'AppData\Local'
        $request = @{root=(Join-Path $env:LOCALAPPDATA 'CodeSeam\Browser'); browser=$selection; runtime='Virtual'; runtimeId=$runtimeId; nodeId=$node.id; nodeName=$node.name; exitIp=$node.exitIp; timezoneTarget=$timezoneTarget; worker=$worker; action=$action; desktopUser='CodeSeam'; desktopPath=(Join-Path $desktopProfile 'Desktop'); runtimeLocked=$runtimeLocked}
        & ([scriptblock]::Create($browserScript))
    } -ArgumentList $request.config.script,$request.config.browser,$record.vmId,$node,$request.config.worker,$request.config.action,$target,$request.config.runtimeLocked
} finally { if ($session) { Remove-PSSession $session } }
