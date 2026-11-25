$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../src-tauri/src/infrastructure'
. ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $source 'guardian_agent.ps1'))))
function Assert($Condition,[string]$Message) { if (!$Condition) { throw $Message } }
# 此处隔离身份识别逻辑，签名验证由真实 Guest 测试覆盖。
function Test-GuardianIdentity([string]$Path,[string]$Kind) { $Path -like 'C:\Trusted\*' }
$at=[DateTime]::UtcNow
$profilePath='C:\Managed\edge\User Data'
$all=@(
    [pscustomobject]@{Name='Code.exe';ProcessId=1;ParentProcessId=0;CreationDate=$at.AddMinutes(-5);ExecutablePath='C:\IDE\Code.exe';CommandLine='IDE'},
    [pscustomobject]@{Name='claude.exe';ProcessId=2;ParentProcessId=1;CreationDate=$at.AddMinutes(-4);ExecutablePath='C:\Trusted\.local\bin\claude.exe';CommandLine='claude'},
    [pscustomobject]@{Name='claude.exe';ProcessId=3;ParentProcessId=2;CreationDate=$at.AddMinutes(-3);ExecutablePath='C:\Trusted\.local\bin\claude.exe';CommandLine='child'},
    [pscustomobject]@{Name='msedge.exe';ProcessId=4;ParentProcessId=1;CreationDate=$at.AddMinutes(-2);ExecutablePath='C:\Trusted\msedge.exe';CommandLine=('msedge --user-data-dir="' + $profilePath + '"')},
    [pscustomobject]@{Name='msedge.exe';ProcessId=5;ParentProcessId=1;CreationDate=$at.AddMinutes(-2);ExecutablePath='C:\Trusted\msedge.exe';CommandLine='msedge --user-data-dir="C:\Personal"'},
    [pscustomobject]@{Name='claude.exe';ProcessId=6;ParentProcessId=1;CreationDate=$at.AddMinutes(-2);ExecutablePath='C:\Untrusted\.local\bin\claude.exe';CommandLine='same name'},
    [pscustomobject]@{Name='node.exe';ProcessId=7;ParentProcessId=1;CreationDate=$at.AddMinutes(-1);ExecutablePath='C:\Trusted\node.exe';CommandLine='node C:\npm\node_modules\@anthropic-ai\claude-code\cli.js'}
)
$found=Get-GuardianProcesses $all $profilePath
Assert (!$found.ContainsKey(1) -and !$found.ContainsKey(5)) 'IDE and personal browser must remain outside the Claude tree'
Assert ($found[2].root -and !$found[3].root -and $found[4].kind -eq 'web' -and $found[7].kind -eq 'code') 'External roots and descendants must be discovered in one snapshot'
Assert (!$found[6].trusted) 'Same executable name must not establish trusted identity'
function Stop-Process { throw 'A recycled or untrusted PID must not be killed' }
function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) [pscustomobject]@{ProcessId=2;CreationDate=$at;ExecutablePath='C:\Other\unrelated.exe'} }
$reused=Stop-GuardianProcesses @{2=$found[2]}
Assert ($reused.Count -eq 0) 'A recycled PID must be ignored'
$untrusted=@(Stop-GuardianProcesses @{6=$found[6]})
Assert ($untrusted.Count -eq 1) 'An untrusted process must remain visible for manual handling'
$fixture=Join-Path $env:TEMP ('codeseam-guardian-unit-' + [guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
$exe=Join-Path $fixture 'claude.exe'; [IO.File]::WriteAllBytes($exe,@(1,2,3))
$script:rule=$null; $script:created=0; $script:interfaces=@('Ethernet')
function Get-NetFirewallRule { param($PolicyStore,$Name,$ErrorAction) $script:rule }
function New-NetFirewallRule { param($Name,$DisplayName,$Group,$Direction,$Action,$Program,$InterfaceAlias,$Profile,$Enabled,$ErrorAction) $script:created++; $script:rule=[pscustomobject]@{Enabled='True';Action='Block';Direction='Outbound'} }
function Get-NetFirewallInterfaceFilter { [CmdletBinding()]param([Parameter(ValueFromPipeline=$true)]$InputObject) process { [pscustomobject]@{InterfaceAlias=$script:interfaces} } }
function Get-NetFirewallApplicationFilter { [CmdletBinding()]param([Parameter(ValueFromPipeline=$true)]$InputObject) process { [pscustomobject]@{Program=$exe} } }
try {
    Assert (Test-GuardianRule $exe @('Ethernet')) 'An owned program must receive a persistent direct-path block'
    Assert (Test-GuardianRule $exe @('Ethernet')) 'Existing matching rules must be reused'
    Assert ($script:created -eq 1) 'Repeated patrols must not duplicate rules'
    $script:interfaces=@('Other Adapter')
    try { $null=Test-GuardianRule $exe @('Ethernet'); throw 'Accepted external rule drift' } catch { if ($_.Exception.Message -notlike '*Guardian*') { throw } }
    Assert (!(Test-GuardianRule (Join-Path $fixture 'node.exe') @('Ethernet'))) 'Shared interpreters must never receive program-wide rules'
    $utc=[DateTime]::SpecifyKind([DateTime]'2026-11-25 10:00:00',[DateTimeKind]::Utc)
    $iso='2026-11-25T10:00:00Z'
    Assert (($utc-([DateTime]$iso).ToUniversalTime()).TotalSeconds -eq 0) 'ISO heartbeats must compare in UTC on UTC+08 hosts'
    $script:browserVersion='2.0'
    function Get-Item { param($LiteralPath,$ErrorAction) [pscustomobject]@{VersionInfo=[pscustomobject]@{ProductVersion=$script:browserVersion}} }
    $profile=@{profileId='owned';nodeId='owned-node';profilePath=$profilePath;timezone=(Get-TimeZone).Id;language=(Get-Culture).Name;version='1.0'}
    $manifest=@{profileId='owned';nodeId='owned-node';profilePath=$profilePath;executable='C:\Fixture\msedge.exe'}
    $driftBlocked=$false
    try { $null=Get-GuardianHealth @{virtualRuntime=$false;profile=$profile} $manifest $false } catch { $driftBlocked=$true }
    Assert $driftBlocked 'Browser version drift must require explicit baseline confirmation'
    $script:browserVersion='1.0'
    $health=Get-GuardianHealth @{virtualRuntime=$false;profile=$profile} $manifest $false
    Assert (@($health.checks | Where-Object id -eq 'browser').Count -eq 1) 'The matching current profile must produce an actual check'
    $snapshotAst=[scriptblock]::Create([IO.File]::ReadAllText((Join-Path $source 'runtime_snapshot.ps1'))).Ast
    $exitProbe=$snapshotAst.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst] -and $_.Body.Extent.Text.Contains('Invoke-WebRequest')} | Select-Object -First 1
    if (!$exitProbe) { throw 'Missing production exit probe' }
    $Virtual=$true; $Profile=@{nodeName='fixture';verification=@{exitIp='192.0.2.1'}}
    $script:traceMode='fallback';$script:traceCalls=0
    function Invoke-WebRequest { param($Uri,[switch]$UseBasicParsing,$TimeoutSec) $script:traceCalls++; if ($script:traceMode -eq 'offline' -or ($script:traceMode -eq 'fallback' -and $script:traceCalls -eq 1)) {throw 'fixture timeout'}; @{Content=$(if ($script:traceMode -eq 'drift') {"ip=192.0.2.2`n"} else {"ip=192.0.2.1`n"})} }
    $checks=@();$exitIp=$null;. ([scriptblock]::Create($exitProbe.Extent.Text))
    Assert ($script:traceCalls -eq 2 -and $checks[0].status -eq 'satisfied' -and $exitIp -eq '192.0.2.1') 'A timed-out primary endpoint must fall back to a real successful observation'
    $script:traceMode='offline';$checks=@();$exitIp=$null;. ([scriptblock]::Create($exitProbe.Extent.Text))
    Assert ($checks[0].status -eq 'unknown' -and !$exitIp) 'Two unavailable endpoints must never reuse a successful exit'
    $script:traceMode='drift';$checks=@();$exitIp=$null;. ([scriptblock]::Create($exitProbe.Extent.Text))
    Assert ($checks[0].status -eq 'pending') 'A measured changed exit must remain drifted'
    $script:publishAttempts=0
    function Move-Item { param($LiteralPath,$Destination,[switch]$Force,$ErrorAction) $script:publishAttempts++; if ($script:publishAttempts -eq 1) {throw [IO.IOException]::new('fixture sharing violation')}; Microsoft.PowerShell.Management\Move-Item @PSBoundParameters }
    $statusPath=Join-Path $fixture 'status.json'
    Write-GuardianJson $statusPath @{state='verified'}
    Assert ($script:publishAttempts -eq 2 -and (Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json).state -eq 'verified') 'A transient sharing violation must not kill status publication'
    foreach ($name in @('guardian_host.ps1','guardian_control.ps1','guardian_apps.ps1')) { $null=[scriptblock]::Create([IO.File]::ReadAllText((Join-Path $source $name))) }
    'PASS: process trees, external sources, identity, PID reuse, rule reuse/conflict, shared interpreters and UTC heartbeat'
} finally {
    $resolved=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $fixture).Path)
    if (!$resolved.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase) -or $resolved -ne [IO.Path]::GetFullPath($fixture)) { throw 'Unexpected cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
