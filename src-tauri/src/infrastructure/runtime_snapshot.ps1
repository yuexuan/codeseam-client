param([string]$Action, $Profile, [bool]$Virtual, [string]$Worker)
$ErrorActionPreference = 'Stop'
$profilePath = [string]$Profile.profilePath
if ([string]::IsNullOrWhiteSpace($profilePath)) { throw '正式浏览器 Profile 路径缺失' }
function Set-ProfileLaunchLock([bool]$Locked) {
    $profileRoot = Split-Path (Split-Path $profilePath)
    $manifestPath = Join-Path $profileRoot 'managed-profile.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.profileId -ne $Profile.profileId) { throw '专用浏览器身份与正式基线不一致，已停止修改启动入口' }
    if ($Worker) { [IO.File]::WriteAllText((Join-Path $profileRoot 'launcher.ps1'), $Worker, [Text.UTF8Encoding]::new($true)) }
    $manifest | Add-Member -NotePropertyName runtimeLocked -NotePropertyValue $Locked -Force
    [IO.File]::WriteAllText(($manifestPath + '.tmp'), ($manifest | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($true))
    Move-Item -LiteralPath ($manifestPath + '.tmp') -Destination $manifestPath -Force
}
if ($Action -eq 'unlock_apps') { Set-ProfileLaunchLock $false; return @{unlocked=$true} }
if ($Action -eq 'pause_apps') {
    # Native 环境仅管理专用浏览器配置目录。外部 Claude 应用
    # 需要由用户自行关闭，不会被静默接管或终止。
    $all = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe' OR Name='msedge.exe' OR Name='chrome.exe'")
    $claude = @($all | Where-Object Name -ieq 'claude.exe')
    if (!$Virtual -and $claude.Count) { throw '请先保存工作并关闭本机 Claude Code / Desktop，再重新配置。' }
    $needle = '(?i)--user-data-dir(?:=|\s+)"?' + [regex]::Escape($profilePath) + '(?:"|\s|$)'
    foreach ($candidate in @($all | Where-Object { $_.CommandLine -match $needle -or ($Virtual -and $_.Name -ieq 'claude.exe') })) {
        $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
        if (!$process) { continue }
        if ($process.MainWindowHandle -ne 0) { $null = $process.CloseMainWindow(); $null = $process.WaitForExit(3000) }
        if (Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue) { Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop }
    }
    Set-ProfileLaunchLock $true
    return @{ stopped=$true }
}
$os = Get-CimInstance Win32_OperatingSystem
$system = Get-CimInstance Win32_ComputerSystem
$cpu = @(Get-CimInstance Win32_Processor)
$disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $os.SystemDrive + "'")
$version = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$timezone = Get-TimeZone
$culture = Get-UICulture
$offset = $timezone.GetUtcOffset([DateTime]::Now)
$sign = if ($offset.TotalMinutes -ge 0) { '+' } else { '-' }
$checks = @()
$exitIp = $null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if (!$Virtual) { throw '本机应用代理出口由运行环境检查单独复验' }
    $trace=$null; $lastError=$null
    foreach ($endpoint in @('https://www.cloudflare.com/cdn-cgi/trace','https://speed.cloudflare.com/cdn-cgi/trace')) {
        try { $trace=(Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 8).Content; break } catch { $lastError=$_.Exception.Message }
    }
    if (!$trace) { throw ('Guest 出口复验未完成：' + $lastError) }
    $line = @($trace -split "`n" | Where-Object { $_.StartsWith('ip=') })
    if ($line.Count -ne 1) { throw 'Guest 出口检测响应缺少唯一 IP' }
    $exitIp = $line[0].Substring(3).Trim()
    [Net.IPAddress]::Parse($exitIp) | Out-Null
    $same = $exitIp -eq $Profile.verification.exitIp
    $checks += @{id='exit'; value=($Profile.nodeName + ' · ' + $exitIp); status=$(if ($same) {'satisfied'} else {'pending'}); label=$(if ($same) {'与基线一致'} else {'出口已变化'})}
} catch { $checks += @{id='exit'; value=$_.Exception.Message; status='unknown'; label='待复验'} }
try {
    if (!$Virtual) { throw '本机 DNS 由运行环境检查单独复验' }
    if ((Get-ScheduledTask -TaskName 'CodeSeam-Network').State -ne 'Running' -or (Get-NetAdapter -Name 'CodeSeam-TUN').Status -ne 'Up') { throw 'Guest 受管代理或 TUN 未运行' }
    $dns = @(Get-NetAdapter | Where-Object Status -eq Up | Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses.Count -gt 0 })
    if (!$dns.Count -or @($dns | Where-Object { $_.ServerAddresses | Where-Object { $_ -ne '198.18.0.2' } }).Count) { throw 'Guest DNS 已偏离受管配置' }
    $null = Resolve-DnsName www.cloudflare.com -DnsOnly -ErrorAction Stop
    $checks += @{id='dns'; value='受管 TUN 与 DNS 解析已复验'; status='satisfied'; label='正常'}
} catch { $checks += @{id='dns'; value=$_.Exception.Message; status='unknown'; label='待复验'} }
try {
    if (@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled).Count) { throw 'IPv6 绑定仍启用，需要复验网络路径' }
    if (!$Virtual) { throw '当前 WebRTC 路径未重新验证' }
    $rule = Get-NetFirewallRule -PolicyStore ActiveStore -Name 'CodeSeam-Block-UDP'
    if ($rule.Enabled -ne 'True' -or $rule.Direction -ne 'Outbound' -or $rule.Action -ne 'Block' -or @(Get-NetFirewallProfile | Where-Object { !$_.Enabled }).Count) { throw 'Guest UDP 防护未启用' }
    $checks += @{id='network'; value='IPv6 已关闭 · UDP 阻断规则已启用；WebRTC 待浏览器复验'; status='unknown'; label='部分已验证'}
} catch { $checks += @{id='network'; value=$_.Exception.Message; status='unknown'; label='待复验'} }
try {
    # 清单位于 User Data 上两级目录，归此运行环境所有。
    $manifestPath = Join-Path (Split-Path (Split-Path $profilePath)) 'managed-profile.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $same = $manifest.profileId -eq $Profile.profileId -and $manifest.profilePath -eq $Profile.profilePath -and $manifest.runtimeId -eq $Profile.runtimeId -and $manifest.nodeId -eq $Profile.nodeId -and $manifest.timezone -eq $timezone.Id -and $manifest.language -eq (Get-Culture).Name
    if (!$same -or !(Test-Path -LiteralPath $profilePath -PathType Container)) { throw '专用 Profile 或环境配置已偏离正式基线' }
    $checks += @{id='browser'; value=$(if ($Virtual) {'Guest Profile 与已确认配置一致'} else {'专用 Profile 与已确认配置一致'}); status='satisfied'; label='配置一致'}
} catch { $checks += @{id='browser'; value=$_.Exception.Message; status='unknown'; label='待复验'} }
$processes = & {
    # WORKBENCH_PROCESSES
} $profilePath | ConvertFrom-Json
$browserData = try { (& {
    # DAILY_BROWSER_SNAPSHOT
} $Action $Profile $Virtual $Worker).browserData } catch { @{error=$_.Exception.Message} }
@{
    browserData=$browserData; processes=$processes
    system=($os.Caption.Replace('Microsoft ', '') + ' ' + $os.OSArchitecture.Replace('-bit','') + ' · ' + $version.DisplayVersion)
    language=$culture.EnglishName; timezone=($timezone.StandardName + ' · UTC' + $sign + $offset.Duration().ToString('hh\:mm'))
    cpu=[int]$system.NumberOfLogicalProcessors; cpuUsage=[math]::Round(($cpu | Measure-Object LoadPercentage -Average).Average)
    memory=[math]::Round($system.TotalPhysicalMemory / 1GB, 1); memoryAvailable=[math]::Round($os.FreePhysicalMemory / 1MB, 1)
    disk=[math]::Round($disk.Size / 1GB, 1); diskAvailable=[math]::Round($disk.FreeSpace / 1GB, 1)
    exitIp=$exitIp; checks=$checks
}
