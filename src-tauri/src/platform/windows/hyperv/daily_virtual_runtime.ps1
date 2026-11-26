$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
if (!$request.config.profile.runtimeId -or $record.vmId -ne $request.config.profile.runtimeId) { throw '当前虚拟机与正式 Runtime 不一致，已停止操作' }
$vm = Get-VM -Id ([guid]$record.vmId) -ErrorAction Stop
if ($request.action -eq 'repair_node') {
    # NODE_REPAIR
    return
}
if ($request.action -eq 'start') {
    if ($record.phase -ne 'guest' -or !$record.deployed) { throw '正式虚拟机的 Windows 安装记录不完整，请检查运行环境。' }
    if ($vm.State -in @('Off', 'Saved')) { Start-VM -VM $vm -ErrorAction Stop | Out-Null }
    elseif ($vm.State -eq 'Paused') { Resume-VM -VM $vm -ErrorAction Stop | Out-Null }
    elseif ($vm.State -notin @('Running', 'Starting', 'Resuming', 'Restoring')) { throw ('虚拟机当前无法启动：' + $vm.State) }
    $session = $null
    try {
        $credential = Import-Clixml -LiteralPath (Join-Path $root 'guest-credential.xml')
        $deadline = [DateTime]::UtcNow.AddSeconds(120)
        $lastError = 'Windows 桌面或受管代理尚未就绪'
        do {
            try {
                $vm = Get-VM -Id ([guid]$record.vmId) -ErrorAction Stop
                if ($vm.State -ne 'Running') { throw ('虚拟机状态：' + $vm.State) }
                if (!$session) { $session = New-PSSession -VMId $record.vmId -Credential $credential -ErrorAction Stop }
                if (!(Test-GuestDesktop $session)) { throw 'Windows 桌面尚未就绪' }
                Invoke-Command -Session $session -ScriptBlock {
                    $task = Get-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop
                    if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop; throw '正在启动受管代理' }
                    if ((Get-NetAdapter -Name 'CodeSeam-TUN' -ErrorAction Stop).Status -ne 'Up') { throw '受管网络正在连接' }
                    # 重启后重新创建的 Wintun 网卡会继承 Windows 默认设置。
                    # 仅恢复自有网卡，不覆盖外部网卡的配置偏移。
                    Get-NetAdapterBinding -Name 'CodeSeam-TUN' -ComponentID ms_tcpip6 -ErrorAction Stop | Where-Object Enabled | Disable-NetAdapterBinding -ErrorAction Stop | Out-Null
                    $tun=Get-NetAdapter -Name 'CodeSeam-TUN' -ErrorAction Stop
                    Set-DnsClientServerAddress -InterfaceIndex $tun.ifIndex -ServerAddresses '198.18.0.2' -ErrorAction Stop
                } -ErrorAction Stop | Out-Null
                @{ready=$true; name=$vm.Name; state='Running'} | ConvertTo-Json -Compress
                return
            } catch {
                $lastError = $_.Exception.Message
                if ($session) { Remove-PSSession $session; $session = $null }
            }
            Start-Sleep -Seconds 3
        } while ([DateTime]::UtcNow -lt $deadline)
        throw ('虚拟机已请求启动，但 120 秒内未就绪：' + $lastError + '。请打开虚拟机窗口检查后重试。')
    } finally { if ($session) { Remove-PSSession $session } }
}
if ($request.action -eq 'stop') {
    if ($vm.State -eq 'Off') { @{stopped=$true;state='Off'} | ConvertTo-Json -Compress; return }
    if ($vm.State -eq 'Paused') { Resume-VM -VM $vm -ErrorAction Stop | Out-Null; $vm=Get-VM -Id ([guid]$record.vmId) -ErrorAction Stop }
    if ($vm.State -ne 'Running') { throw ('虚拟机当前无法正常关机：' + $vm.State + '。请先启动或恢复后再停止。') }
    # 请求 Guest 操作系统正常关机，不回退为断电操作。
    Stop-VM -VM $vm -Confirm:$false -ErrorAction Stop | Out-Null
    $vm=Get-VM -Id ([guid]$record.vmId) -ErrorAction Stop
    if ($vm.State -ne 'Off') { throw ('虚拟机关机尚未完成，当前状态：' + $vm.State) }
    @{stopped=$true;state='Off'} | ConvertTo-Json -Compress
    return
}
if ($request.action -eq 'open_console') {
    $consoleId = Open-GuestConsole $record.vmId
    @{opened=$true; processId=$consoleId} | ConvertTo-Json -Compress
    return
}
$result = @{
    at=[DateTime]::UtcNow.ToString('o'); name=$vm.Name; state=[string]$vm.State; online=$false
    platform=('Hyper-V · 第 ' + $vm.Generation + ' 代'); cpu=[int]$vm.ProcessorCount; cpuUsage=$null
    memory=[math]::Round($vm.MemoryStartup / 1GB, 1); memoryAvailable=$null
    disk=$null; diskAvailable=$null; system=$null; language=$null; timezone=$null; exitIp=$null; checks=@(); error=$null
}
$disk = @(Get-VMHardDiskDrive -VM $vm | ForEach-Object { Get-VHD -Path $_.Path })
if ($disk.Count) { $result.disk = [math]::Round(($disk | Measure-Object Size -Sum).Sum / 1GB, 1) }
if ($vm.State -ne 'Running') {
    if ($request.action -in @('pause_apps','unlock_apps')) { @{stopped=$true;deferred=$true} | ConvertTo-Json -Compress; return }
    $result | ConvertTo-Json -Depth 10 -Compress
    return
}
$session = $null
try {
    $credential = Import-Clixml -LiteralPath (Join-Path $root 'guest-credential.xml')
    $session = New-PSSession -VMId $record.vmId -Credential $credential -ErrorAction Stop
    $snapshot = Invoke-Command -Session $session -ScriptBlock ([ScriptBlock]::Create($request.config.script)) -ArgumentList $request.action,$request.config.profile,$true,$request.config.worker
    if ($request.action -in @('pause_apps','unlock_apps')) { $snapshot | ConvertTo-Json -Compress; return }
    $result.online = $true
    foreach ($key in @('system','language','timezone','cpuUsage','memoryAvailable','diskAvailable','exitIp','checks','browserData','processes')) { $result[$key] = $snapshot.$key }
} catch {
    if ($request.action -in @('pause_apps','unlock_apps')) { throw }
    $result.error = 'Guest 只读观测未完成：' + $_.Exception.Message
} finally { if ($session) { Remove-PSSession $session } }
$result | ConvertTo-Json -Depth 18 -Compress
