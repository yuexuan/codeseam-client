$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../src-tauri/src/infrastructure'
$directory = Join-Path ([IO.Path]::GetTempPath()) ('codeseam-node-repair-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $directory
try {
    # 在隔离目录和模拟引擎中运行正式流程。
    Add-Type -TypeDefinition 'public class FixtureEngine { public static void Main() {} }' -OutputAssembly (Join-Path $directory 'mihomo.exe') -OutputType ConsoleApplication
    $body = [IO.File]::ReadAllText((Join-Path $source 'node_repair.ps1')).Replace("'C:\ProgramData\CodeSeam\Network'", ("'" + $directory.Replace("'", "''") + "'"))
    $root = $directory
    $record = [pscustomobject]@{vmId=[guid]::NewGuid().ToString();node=@{id='old';exitIp='192.0.2.1'}}
    $vm = @{State='Running'}
    $request = @{config=@{node=@{id='new';exitIp='192.0.2.2'};nodeConfig=@{name='fixture';type='http';server='127.0.0.1';port=1234};timezoneTarget=@{windowsId='Singapore Standard Time'}}}
    $script:state = 'Running'; $script:saved = 0; $script:closed = 0; $script:fail = $false; $script:timezoneCalls = 0; $script:ipv6 = $true; $script:dns = @{}
    function Import-Clixml { param($LiteralPath) 'fixture credential' }
    function New-PSSession { param($VMId,$Credential,$ErrorAction) if ($VMId -ne $record.vmId) { throw 'Wrong VM' }; 'fixture session' }
    function Remove-PSSession { param($Session) $script:closed++ }
    function Test-GuestDesktop { param($Session) $true }
    function Start-Sleep { param($Seconds,$Milliseconds) }
    function Stop-ScheduledTask { param($TaskName,$ErrorAction) if ($TaskName -ne 'CodeSeam-Network') { throw 'Unowned task' }; $script:state='Ready' }
    function Start-ScheduledTask { param($TaskName,$ErrorAction) $script:state='Running' }
    function Get-ScheduledTask { param($TaskName) @{State=$script:state} }
    function Get-NetAdapter { param($Name) if ($Name) { return @{Status='Up';ifIndex=5} }; @(@{Status='Up';ifIndex=5},@{Status='Up';ifIndex=7}) }
    function Get-NetRoute { param($AddressFamily,$DestinationPrefix,$ErrorAction) @(@{InterfaceAlias='CodeSeam-TUN';InterfaceIndex=5;NextHop='198.18.0.2';RouteMetric=0},@{InterfaceAlias='Ethernet';InterfaceIndex=7;NextHop='192.0.2.254';RouteMetric=0}) }
    function Get-NetIPInterface { param($InterfaceIndex,$AddressFamily,$ErrorAction) @{InterfaceMetric=25} }
    function Get-NetAdapterBinding { param($ComponentID,$ErrorAction) @{Enabled=$script:ipv6} }
    function Disable-NetAdapterBinding { param($ErrorAction) process { $script:ipv6=$false } }
    function Set-DnsClientServerAddress { param($InterfaceIndex,$ServerAddresses,$ErrorAction) $script:dns[$InterfaceIndex]=$ServerAddresses }
    function Invoke-WebRequest { param($Uri,[switch]$UseBasicParsing,$TimeoutSec) if ($script:fail) { throw 'Fixture connection failed' }; if ($script:ipv6 -or $script:dns[5] -ne '198.18.0.2' -or $script:dns[7] -ne '198.18.0.2') { throw 'Recreated TUN policy was not restored before probing' }; @{Content="ip=192.0.2.2`n"} }
    function Resolve-DnsName { param($Name,[switch]$DnsOnly,$ErrorAction) 'fixture answer' }
    function Invoke-Command { param($Session,$ScriptBlock,$ArgumentList,$ErrorAction) & $ScriptBlock @ArgumentList }
    function Sync-GuestTimezone { param($Session,$Target) $script:timezoneCalls++; 'Singapore Standard Time' }
    function Save-Checkpoint { param($Record) $script:saved++ }
    $providerPath = Join-Path $directory 'selected.yaml'
    $configPath = Join-Path $directory 'config.json'
    $oldConfig = '{"tun":{"device":"CodeSeam-TUN","enable":true,"auto-detect-interface":true}}'
    [IO.File]::WriteAllText($configPath, $oldConfig)
    [IO.File]::WriteAllText($providerPath, 'old provider')
    $script:fail = $true
    try { $null = & ([scriptblock]::Create($body)); throw 'Accepted broken exit' } catch { if ($_.Exception.Message -notlike '*Fixture connection failed*') { throw } }
    if ([IO.File]::ReadAllText($providerPath) -ne 'old provider' -or [IO.File]::ReadAllText($configPath) -ne $oldConfig -or $record.node.id -ne 'old' -or $script:saved -ne 0 -or $script:timezoneCalls -ne 0 -or $script:closed -ne 1 -or $script:state -ne 'Running') { throw 'Failure must restore the old provider and config, preserve binding, and close the session' }
    $script:fail = $false
    $script:ipv6 = $true; $script:dns = @{}
    $result = & ([scriptblock]::Create($body)) | ConvertFrom-Json
    if (!$result.applied -or $result.nodeId -ne 'new' -or $record.node.id -ne 'new' -or $script:saved -ne 1 -or $script:closed -ne 2 -or $script:timezoneCalls -ne 1) { throw 'Successful retry must verify the exit before committing the node binding' }
    if ([IO.File]::ReadAllText($providerPath) -notlike '*127.0.0.1*') { throw 'New provider was not installed' }
    $appliedConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($appliedConfig.'interface-name' -ne 'Ethernet' -or $appliedConfig.tun.'auto-detect-interface') { throw 'Proxy outbound must use the real uplink rather than its own TUN' }
    'PASS: provider/config rollback, real uplink binding, recreated TUN DNS/IPv6 policy, verified retry and session cleanup'
} finally {
    $resolved = [IO.Path]::GetFullPath($directory)
    if (!$resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'codeseam-node-repair-*') { throw 'Unexpected test directory' }
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
