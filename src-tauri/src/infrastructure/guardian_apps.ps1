param($Profile, [bool]$Virtual, [string]$Operation, [string]$Kind, [bool]$Force)
$ErrorActionPreference='Stop'
# GUARDIAN_LIBRARY
$identified=Get-GuardianProcesses @(Get-CimInstance Win32_Process) $Profile.profilePath
if ($Operation -eq 'repair') {
    if (!$Virtual) { return @{repaired=$true} }
    $settings=Get-Content -LiteralPath 'C:\ProgramData\CodeSeam\Guardian\config.json' -Raw | ConvertFrom-Json
    if ($settings.profile.profileId -ne $Profile.profileId) { throw 'Guardian 与正式 Profile 身份不一致' }
    if ($settings.networkConfigHash -and (Get-FileHash -LiteralPath 'C:\ProgramData\CodeSeam\Network\config.json' -Algorithm SHA256).Hash -ne $settings.networkConfigHash) { throw '受管代理配置存在外部冲突，未覆盖，请重新配置环境' }
    $external=@(Get-NetAdapter | Where-Object { $_.Name -ne 'CodeSeam-TUN' -and $_.Status -eq 'Up' })
    foreach ($adapter in $external) {
        if (@($adapter | Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled).Count) { throw '外部网卡 IPv6 与已应用值冲突，未覆盖，请重新配置环境' }
        $dns=@($adapter | Get-DnsClientServerAddress -AddressFamily IPv4)
        if (@($dns.ServerAddresses | Where-Object {$_ -ne '198.18.0.2'}).Count) { throw '外部网卡 DNS 与已应用值冲突，未覆盖，请重新配置环境' }
    }
    Start-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    do { $tun=Get-NetAdapter -Name 'CodeSeam-TUN' -ErrorAction SilentlyContinue; if ($tun -and $tun.Status -eq 'Up') { break }; Start-Sleep -Seconds 1 } while ([DateTime]::UtcNow -lt $deadline)
    if (!$tun -or $tun.Status -ne 'Up') { throw '受管代理恢复后 TUN 未就绪，保持锁定' }
    Get-NetAdapterBinding -Name 'CodeSeam-TUN' -ComponentID ms_tcpip6 | Where-Object Enabled | Disable-NetAdapterBinding | Out-Null
    Set-DnsClientServerAddress -InterfaceIndex $tun.ifIndex -ServerAddresses '198.18.0.2'
    return @{repaired=$true}
}
if ($Operation -eq 'stop') {
    $remaining=@(Stop-GuardianProcesses $identified $Kind $Force)
    return @{stopped=($remaining.Count -eq 0);remaining=$remaining}
}
if ($Operation -eq 'suspend') {
    $null=Set-GuardianProfileLock $Profile $true
    if ($Virtual) { Stop-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction SilentlyContinue | Out-Null }
    return @{suspended=$true}
}
if ($Operation -eq 'shutdown') {
    $identified=Get-GuardianProcesses @(Get-CimInstance Win32_Process) $Profile.profilePath
    if ($identified.Count) { throw '仍有 Claude 进程运行，Guardian 与网络保护继续保留' }
    $null=Set-GuardianProfileLock $Profile $true
    if ($Virtual) {
        Stop-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName 'CodeSeam-Guardian' -Confirm:$false -ErrorAction SilentlyContinue
        Stop-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop
        Get-NetFirewallRule -Group 'CodeSeam Guardian' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    }
    return @{stopped=$true}
}
if ($Operation -ne 'start' -or $Kind -notin @('code','desktop')) { throw '不支持的应用操作' }
if (!$Virtual) { throw '本机 Claude Code / Desktop 网络隔离尚未验收，无法启动受保护实例' }
if (@($identified.Values | Where-Object kind -eq $Kind).Count) { return @{started=$true;reused=$true} }
$desktopHome=if ($Profile.profilePath -match '^(?<home>.+)\\AppData\\Local\\') {$Matches.home} else {throw 'Guest 桌面目录无法识别'}
$executable=if ($Kind -eq 'code') {Join-Path $desktopHome '.local\bin\claude.exe'} else {
    $candidates=@(Get-ChildItem -LiteralPath (Join-Path $desktopHome 'AppData\Local\AnthropicClaude') -Directory -Filter 'app-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object {Join-Path $_.FullName 'claude.exe'} | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf})
    if ($candidates.Count) {$candidates[0]} else {$null}
}
if (!$executable -or !(Test-Path -LiteralPath $executable -PathType Leaf)) { throw '没有找到可安全启动的 Claude 可执行文件，请从官方安装入口安装' }
if (!(Test-GuardianIdentity $executable $Kind)) { throw '应用发布者身份未通过验证，已取消启动' }
$interfaces=@(Get-NetAdapter | Where-Object { $_.Status -ne 'Disabled' -and $_.Name -ne 'CodeSeam-TUN' -and $_.InterfaceDescription -notmatch 'Loopback' } | Select-Object -ExpandProperty Name)
if (!(Test-GuardianRule $executable $interfaces)) { throw '应用的直接网络路径未被阻断，已取消启动' }
$name='CodeSeam-App-' + [guid]::NewGuid().ToString('N')
$action=if ($Kind -eq 'code') {
    New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NoExit -Command "& ''' + $executable.Replace("'","''") + '''"') -WorkingDirectory $desktopHome
} else {New-ScheduledTaskAction -Execute $executable -WorkingDirectory (Split-Path $executable)}
$principal=New-ScheduledTaskPrincipal -UserId 'CodeSeam' -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
try {
    Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $name
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    do {
        $found=Get-GuardianProcesses @(Get-CimInstance Win32_Process) $Profile.profilePath
        if (@($found.Values | Where-Object kind -eq $Kind).Count) { return @{started=$true} }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    throw '已请求启动应用，但没有发现对应进程，请检查 Guest 桌面后重试'
} finally { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue }
