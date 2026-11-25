$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../src-tauri/src/infrastructure'
$scriptBody = [IO.File]::ReadAllText((Join-Path $source 'daily_virtual_runtime.ps1'))
$snapshotBody = [IO.File]::ReadAllText((Join-Path $source 'runtime_snapshot.ps1'))
$testRoot = Join-Path $env:TEMP ('codeseam-runtime-observe-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testRoot
$root = $testRoot
$recordPath = Join-Path $testRoot 'checkpoint.json'
$vmId = [guid]::NewGuid().ToString()
@{vmId=$vmId} | ConvertTo-Json | Set-Content -LiteralPath $recordPath
$request = @{action='observe'; config=@{profile=@{runtimeId=$vmId; profilePath='C:\Managed\edge\User Data'}; script='fixture'}}
$script:state = 'Off'
$script:closed = 0
$script:connected = 0
function Get-VM { param($Id, $ErrorAction) if ([string]$Id -ne $vmId) { throw 'Wrong VM' }; return @{Name='Fixture VM';State=$script:state;Generation=2;ProcessorCount=2;MemoryStartup=4GB} }
function Get-VMHardDiskDrive { param($VM) return @{Path='fixture.vhdx'} }
function Get-VHD { param($Path) return [pscustomobject]@{Size=64GB} }
function Import-Clixml { param($LiteralPath) return 'credential fixture' }
function New-PSSession { param($VMId,$Credential,$ErrorAction) $script:connected++; return 'session fixture' }
function Remove-PSSession { param($Session) $script:closed++ }
function Invoke-Command {
    param($Session,$ScriptBlock,$ArgumentList)
    return @{system='Windows fixture';language='English';timezone='UTC+08:00';cpuUsage=12;memoryAvailable=2;diskAvailable=32;exitIp='203.0.113.10';checks=@(@{id='exit';status='pending';label='出口已变化';value='fixture changed exit'})}
}
function Open-GuestConsole { param($Id) if ($Id -ne $vmId) { throw 'Wrong console VM' }; return 123 }
try {
    $offline = & ([scriptblock]::Create($scriptBody)) | ConvertFrom-Json
    if ($offline.online -or $offline.exitIp -or $offline.checks.Count -or $script:connected -ne 0) { throw 'Offline VM must not reuse old health or create a Guest session' }
    if ($offline.cpu -ne 2 -or $offline.disk -ne 64) { throw 'Offline VM resource allocation must remain readable' }
    $script:state = 'Running'
    $running = & ([scriptblock]::Create($scriptBody)) | ConvertFrom-Json
    if (!$running.online -or $running.checks[0].status -ne 'pending' -or $script:closed -ne 1) { throw 'Live observation must preserve drift and close its session' }
    $request.action = 'open_console'
    $console = & ([scriptblock]::Create($scriptBody)) | ConvertFrom-Json
    if (!$console.opened -or $console.processId -ne 123 -or $script:connected -ne 1) { throw 'Open console must use only the formal VM without reconfiguring Guest networking' }
    $request.config.profile.runtimeId = [guid]::NewGuid().ToString()
    try { $null = & ([scriptblock]::Create($scriptBody)); throw 'Accepted another VM' } catch { if ($_.Exception.Message -notlike '*正式 Runtime 不一致*') { throw } }
    function Get-CimInstance { param($ClassName,$Filter) return @{Name='claude.exe';ProcessId=999} }
    function Stop-Process { throw 'Must never terminate an external Native Claude app' }
    try { $null = & ([scriptblock]::Create($snapshotBody)) 'pause_apps' @{profilePath='C:\Managed\edge\User Data'} $false; throw 'Accepted external Claude' } catch { if ($_.Exception.Message -notlike '*请先保存工作并关闭本机 Claude*') { throw } }
    function Get-CimInstance { param($ClassName,$Filter) return @() }
    $managedRoot = Join-Path $testRoot 'Browser'
    $profilePath = Join-Path $managedRoot 'edge\User Data'
    $null = New-Item -ItemType Directory -Path $profilePath -Force
    $manifestPath = Join-Path $managedRoot 'managed-profile.json'
    @{profileId='fixture-profile';unrelated='keep'} | ConvertTo-Json | Set-Content -LiteralPath $manifestPath
    $profile = @{profileId='fixture-profile';profilePath=$profilePath}
    $paused = & ([scriptblock]::Create($snapshotBody)) 'pause_apps' $profile $false 'fixture worker'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if (!$paused.stopped -or !$manifest.runtimeLocked -or $manifest.unrelated -ne 'keep') { throw 'Pausing must lock the owned shortcut and preserve the manifest' }
    $unlocked = & ([scriptblock]::Create($snapshotBody)) 'unlock_apps' $profile $false 'fixture worker'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if (!$unlocked.unlocked -or $manifest.runtimeLocked -or !(Test-Path -LiteralPath $profilePath)) { throw 'Cancel/commit must release the matching profile without removing it' }
    $workerAst = [scriptblock]::Create([IO.File]::ReadAllText((Join-Path $source 'browser_worker.ps1'))).Ast
    $workerTry = $workerAst.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] } | Select-Object -First 1
    $guard = $workerTry.Body.Statements | Where-Object { $_.Extent.Text -like '*$manifest.runtimeLocked -eq*' } | Select-Object -First 1
    if (!$guard) { throw 'Managed launch lock is missing' }
    $manifest = @{runtimeLocked=$true}
    foreach ($Mode in @('open','install_code','install_desktop')) {
        try { & ([scriptblock]::Create($guard.Extent.Text)); throw 'Accepted locked runtime' } catch { if ($_.Exception.Message -notlike '*正式 Runtime*') { throw } }
    }
    foreach ($Mode in @('verify','inspect')) { & ([scriptblock]::Create($guard.Extent.Text)) }
    'PASS: offline, drift, VM identity, console, process ownership and managed launch locks'
} finally {
    $resolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $testRoot).Path)
    if (![string]::Equals($resolved, [IO.Path]::GetFullPath($testRoot), [StringComparison]::OrdinalIgnoreCase) -or !$resolved.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
