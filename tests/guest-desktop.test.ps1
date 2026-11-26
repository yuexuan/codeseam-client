$ErrorActionPreference = 'Stop'
. ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/hyperv/guest_install.ps1'))))
function Invoke-Command { param($Session,$ScriptBlock) & $ScriptBlock }
function Get-ItemProperty { param($Path) return @{SystemSetupInProgress=0; OOBEInProgress=0} }
$script:oobe = $true
$script:owner = 'CodeSeam'
$script:shell = $true
function Get-Process { param($Name) if ($script:oobe) { return @{Name='CloudExperienceHost'} } }
function Get-CimInstance { param($ClassName,$Filter) if ($script:shell) { return @{Name='explorer.exe'} } }
function Invoke-CimMethod { param($InputObject,$MethodName) return @{ReturnValue=0; User=$script:owner} }
if (Test-GuestDesktop 'session') { throw 'OOBE must block readiness even when registry flags are zero' }
$script:oobe = $false
if (!(Test-GuestDesktop 'session')) { throw 'CodeSeam desktop should be ready' }
$script:owner = 'defaultuser0'
if (Test-GuestDesktop 'session') { throw 'Setup user shell is not the CodeSeam desktop' }
$script:shell = $false
if (Test-GuestDesktop 'session') { throw 'A remoting channel alone is not a ready desktop' }
'PASS: OOBE, setup account and missing desktop block readiness'

$script:oobe = $true
if (!(Test-GuestSetupRecovery 'session')) { throw 'Active OOBE must trigger recovery' }
$script:oobe = $false
$script:shell = $true
$script:owner = 'defaultuser0'
if (!(Test-GuestSetupRecovery 'session')) { throw 'Stranded setup desktop must trigger recovery even with cleared setup flags' }
$script:owner = 'CodeSeam'
if (Test-GuestSetupRecovery 'session') { throw 'Working desktop must not trigger setup recovery' }
$script:shell = $false
if (Test-GuestSetupRecovery 'session') { throw 'Missing shell alone must not trigger sysprep' }
'PASS: setup recovery covers OOBE and stranded defaultuser0, preserves working desktops'
