param([ValidateSet('diagnose','health','cycle','offline','network','watchdog')][string]$Scenario='diagnose')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$dataRoot=Join-Path $env:LOCALAPPDATA 'CodeSeam'
$recordBytes=[IO.File]::ReadAllBytes((Join-Path $dataRoot 'workbench-v1.dpapi'))
$formal=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($recordBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)) | ConvertFrom-Json
if (!$formal.virtualRuntime) { throw 'This live check requires the existing formal Guest' }
$source=Join-Path $PSScriptRoot '../src-tauri/src/infrastructure'
$controller=[IO.File]::ReadAllText((Join-Path $source 'virtual_runtime.ps1')).TrimStart([char]0xfeff)
foreach ($entry in @(@('# GUEST_FUNCTIONS','guest_install.ps1'),@('# GUEST_BROWSER','guest_browser.ps1'),@('# DAILY_RUNTIME','daily_virtual_runtime.ps1'),@('# NODE_REPAIR','node_repair.ps1'),@('# CONSOLE_DISPLAY','console_display.ps1'))) {
    $controller=$controller.Replace($entry[0],[IO.File]::ReadAllText((Join-Path $source $entry[1])).TrimStart([char]0xfeff))
}
function Invoke-Formal([string]$Action,[string]$Script='') {
    $request=@{action=$Action;root=(Join-Path $dataRoot 'Virtual');config=@{profile=$formal.baseline.profile;script=$Script}}
    & ([scriptblock]::Create($controller)) | ConvertFrom-Json
}
function Read-Heartbeat {
    $bytes=[IO.File]::ReadAllBytes((Join-Path $dataRoot 'guardian-v1.dpapi'))
    [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)) | ConvertFrom-Json
}
if ($Scenario -eq 'diagnose') {
    $result=Invoke-Formal 'observe' @'
$task=Get-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction SilentlyContinue
$info=Get-ScheduledTaskInfo -TaskName 'CodeSeam-Guardian' -ErrorAction SilentlyContinue
$status=Get-Content -LiteralPath 'C:\ProgramData\CodeSeam\Guardian\status.json' -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
$lastError=Get-Content -LiteralPath 'C:\ProgramData\CodeSeam\Guardian\last-error.txt' -Raw -ErrorAction SilentlyContinue
$diagnosis=@{taskState=[string]$task.State;lastResult=$info.LastTaskResult;lastRun=$info.LastRunTime;restartCount=$task.Settings.RestartCount;lastError=$lastError;at=$status.at;state=$status.state;error=$status.error;generation=$status.generation;dns=@(Get-NetAdapter | Where-Object Status -eq Up | Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object InterfaceAlias,ServerAddresses);ipv6=@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled | Select-Object Name,Enabled);networkTask=[string](Get-ScheduledTask -TaskName 'CodeSeam-Network').State}
@{system=$diagnosis;processes=$status.processes;checks=$status.checks}
'@
    $result | Select-Object state,online,system,processes,checks,error | ConvertTo-Json -Depth 14
    exit
}
if ($Scenario -eq 'health') {
    $snapshot=[IO.File]::ReadAllText((Join-Path $source 'runtime_snapshot.ps1')).Replace('# WORKBENCH_PROCESSES',[IO.File]::ReadAllText((Join-Path $source 'workbench.ps1')))
    $result=Invoke-Formal 'observe' $snapshot
    $result | Select-Object state,online,exitIp,checks,error | ConvertTo-Json -Depth 8
    if (!$result.online -or $result.error -or @($result.checks | Where-Object {$_.id -in @('exit','dns','browser') -and $_.status -ne 'satisfied'}).Count) { throw 'Formal Guest health verification failed' }
    exit
}
if ($Scenario -eq 'watchdog') {
    $before=Read-Heartbeat
    if (!$before.online -or $before.state -ne 'monitoring') { throw 'The real Guest must be healthy before fault injection' }
    $stoppedAt=[DateTime]::UtcNow
    $null=Invoke-Formal 'observe' "Stop-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction Stop; @{checks=@()}"
    $deadline=[DateTime]::UtcNow.AddSeconds(90); $invalidated=$false
    do {
        Start-Sleep -Seconds 2; $value=Read-Heartbeat
        if (!$value.online -or $value.state -ne 'monitoring') { $invalidated=$true }
        if ($invalidated -and $value.online -and $value.state -eq 'monitoring' -and ([DateTime]$value.at).ToUniversalTime() -gt $stoppedAt) {
            'PASS: watchdog invalidated stale success, restarted the stopped Guest agent and reverified without UI intervention'
            exit
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw ('Guest watchdog did not recover: ' + $value.error)
}
if ($Scenario -in @('cycle','offline')) {
    $null=Invoke-Formal 'stop'
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    do { Start-Sleep -Seconds 1; $off=Read-Heartbeat } while ($off.vmState -ne 'Off' -and [DateTime]::UtcNow -lt $deadline)
    if ($off.vmState -ne 'Off' -or $off.online -or $off.processes) { throw 'Stopped Guest retained online/process evidence' }
    'PASS: shutdown observed offline, stale processes removed'
    if ($Scenario -eq 'offline') { exit }
    $start=Invoke-Formal 'start'
    if (!$start.ready) { throw 'VM did not start' }
    $deadline=[DateTime]::UtcNow.AddSeconds(90)
    do { Start-Sleep -Seconds 3; $on=Read-Heartbeat } while ((!$on.online -or $on.state -ne 'monitoring') -and [DateTime]::UtcNow -lt $deadline)
    if (!$on.online -or $on.vmState -ne 'Running' -or $on.state -ne 'monitoring') { throw ('Guest did not recover: ' + $on.error) }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $dataRoot 'workbench-v1.dpapi'))) -ne [Convert]::ToBase64String($recordBytes)) { throw 'Formal record changed during direct lifecycle probe' }
    'PASS: startup restored real Guest heartbeat; formal baseline preserved'
}
if ($Scenario -eq 'network') {
    try {
        $null=Invoke-Formal 'observe' "Stop-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop; @{checks=@()}"
        $deadline=[DateTime]::UtcNow.AddSeconds(60)
        do { Start-Sleep -Seconds 3; $value=Read-Heartbeat } while ($value.state -ne 'locked' -and [DateTime]::UtcNow -lt $deadline)
        if ($value.state -ne 'locked') { throw ('Proxy failure was not locked: ' + $value.error) }
        if ($value.processes.web.count -gt 0) { throw 'Managed browser was not closed after proxy failure' }
        'PASS: proxy failure locked Guardian and paused application launches'
        $probe=Invoke-Formal 'observe' @'
param($Action,$Profile)
$ErrorActionPreference='Stop'
$dir=Join-Path $env:TEMP ('codeseam-guardian-path-' + [guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $dir
$child=$null
try {
    $rule=@(Get-NetFirewallRule -Group 'CodeSeam Guardian' -PolicyStore ActiveStore | Where-Object {$_.Enabled -eq 'True' -and $_.Direction -eq 'Outbound' -and $_.Action -eq 'Block'} | Get-NetFirewallApplicationFilter | Where-Object Program -eq $Profile.executable)
    if (!$rule.Count) { throw 'No persistent block for the real managed browser executable' }
    $control=Test-NetConnection -ComputerName 1.1.1.1 -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
    $arguments=@('--headless=new','--disable-gpu','--no-first-run','--no-proxy-server',('--user-data-dir="' + $dir + '\Profile"'),'--dump-dom','https://1.1.1.1/cdn-cgi/trace')
    $child=Start-Process -FilePath $Profile.executable -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput "$dir\out.txt" -RedirectStandardError "$dir\err.txt" -PassThru
    $exited=$child.WaitForExit(12000)
    if (!$exited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
    $content=Get-Content -LiteralPath "$dir\out.txt" -Raw -ErrorAction SilentlyContinue
    if ($content -match '(?m)^ip=') { throw 'FAIL: managed browser reached a direct external path with proxy stopped' }
    @{system=@{physicalControl=[bool]$control;browserDirectBlocked=$true;ruleInstalled=$true};checks=@()}
} finally {
    foreach ($p in @(Get-CimInstance Win32_Process | Where-Object {$_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -like ('*' + $dir + '*')})) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    $resolved=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $dir).Path)
    if ($resolved -ne [IO.Path]::GetFullPath($dir) -or !$resolved.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected path probe cleanup target' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
'@
        if (!$probe.system.physicalControl) { throw 'Direct path probe is inconclusive: the unblocked control could not reach the test endpoint' }
        if (!$probe.system.browserDirectBlocked) { throw 'Browser direct path was not blocked' }
        'PASS: physical TCP control succeeded while the real browser direct path remained blocked'
    } finally {
        $null=Invoke-Formal 'observe' "Start-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop; @{checks=@()}"
    }
}
