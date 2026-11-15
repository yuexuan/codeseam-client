# 由提权后的 Hyper-V 控制器执行，浏览器配置数据保存在虚拟机内。
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
    if ($request.action -eq 'ensure_ready') {
        Invoke-Command -Session $session -ScriptBlock {
            $setup = Get-ItemProperty HKLM:\SYSTEM\Setup
            if ($setup.SystemSetupInProgress -ne 0 -or $setup.OOBEInProgress -ne 0) { throw 'Guest Windows 首次设置尚未完成。' }
            if ((Get-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop).State -ne 'Running') { throw 'Guest 受管代理未运行，请返回运行环境修复。' }
        }
        if ($request.config.openConsole -eq $true) {
            # 明确选择“下一步”后显示桌面，而不只是无界面启动虚拟机。
            $connection = Join-Path $env:SystemRoot 'System32\vmconnect.exe'
            if (!(Test-Path -LiteralPath $connection -PathType Leaf)) { throw '未找到 Hyper-V 虚拟机连接窗口，请安装 Hyper-V 管理工具后重试。' }
            $vmId = ([guid]$record.vmId).ToString()
            Start-Process -FilePath $connection -ArgumentList @('localhost', '-G', $vmId) -WindowStyle Normal -ErrorAction Stop | Out-Null
        }
        @{ ready=$true; state='Running'; name=$record.name } | ConvertTo-Json -Compress
        return
    }
    $node = $request.config.node
    if ($node.id -ne $record.node.id) { throw '当前节点与 Guest 绑定不一致，请先重新配置 Guest 网络。' }
    Invoke-Command -Session $session -ScriptBlock {
        param($browserScript, $selection, $runtimeId, $node)
        $setup = Get-ItemProperty HKLM:\SYSTEM\Setup
        if ($setup.SystemSetupInProgress -ne 0 -or $setup.OOBEInProgress -ne 0) { throw 'Guest Windows 首次设置尚未完成。' }
        if ((Get-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop).State -ne 'Running') { throw 'Guest 受管代理未运行，请返回运行环境修复。' }
        # 管理操作以 CodeSeamAgent 运行，浏览器数据归可见桌面的用户所有。
        $desktopUser = Get-LocalUser -Name CodeSeam -ErrorAction Stop
        $profileKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $desktopUser.SID.Value
        $desktopProfile = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $profileKey -ErrorAction Stop).ProfileImagePath)
        $env:LOCALAPPDATA = Join-Path $desktopProfile 'AppData\Local'
        $request = @{root=(Join-Path $env:LOCALAPPDATA 'CodeSeam\Browser'); browser=$selection; runtime='Virtual'; runtimeId=$runtimeId; nodeId=$node.id; nodeName=$node.name}
        & ([scriptblock]::Create($browserScript))
    } -ArgumentList $request.config.script,$request.config.browser,$record.vmId,$node
} finally { if ($session) { Remove-PSSession $session } }
