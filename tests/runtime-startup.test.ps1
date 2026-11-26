$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../src-tauri/src/platform/windows'
$body = [IO.File]::ReadAllText((Join-Path $source 'hyperv/daily_virtual_runtime.ps1'))
$testRoot = Join-Path $env:TEMP ('codeseam-startup-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testRoot
$root = $testRoot
$recordPath = Join-Path $root 'checkpoint.json'
$vmId = [guid]::NewGuid().ToString()
@{vmId=$vmId;phase='guest';deployed=$true} | ConvertTo-Json | Set-Content -LiteralPath $recordPath
$request = @{action='start';config=@{profile=@{runtimeId=$vmId}}}
$script:state = 'Off'
$script:starts = 0; $script:resumes = 0; $script:closed = 0; $script:waits = 0; $script:probes = 0
function Get-VM { param($Id,$ErrorAction) if ([string]$Id -ne $vmId) { throw 'Wrong VM' }; @{Name='Fixture';State=$script:state} }
function Start-VM { param($VM,$ErrorAction) $script:starts++; $script:state='Running' }
function Resume-VM { param($VM,$ErrorAction) $script:resumes++; $script:state='Running' }
function Import-Clixml { param($LiteralPath) 'fixture credential' }
function New-PSSession { param($VMId,$Credential,$ErrorAction) if ($VMId -ne $vmId) { throw 'Wrong session VM' }; 'fixture session' }
function Remove-PSSession { param($Session) $script:closed++ }
function Test-GuestDesktop { param($Session) $script:probes++; return $script:probes -gt 1 }
function Invoke-Command { param($Session,$ScriptBlock,$ErrorAction) }
function Start-Sleep { param($Seconds) $script:waits++ }
try {
    foreach ($state in @('Off','Saved','Paused','Running')) {
        $script:state = $state
        $result = & ([scriptblock]::Create($body)) | ConvertFrom-Json
        if (!$result.ready -or $result.state -ne 'Running') { throw "Failed to restore $state VM" }
    }
    if ($script:starts -ne 2 -or $script:resumes -ne 1 -or $script:closed -ne 5 -or $script:waits -ne 1) { throw 'Startup must reuse running VMs, wait for the desktop and close every session' }
    $before = Get-Content -LiteralPath $recordPath -Raw
    if ($before -notmatch $vmId) { throw 'Startup changed the checkpoint' }
    $request.action='stop'
    $script:stops=0
    function Stop-VM { param($VM,$Confirm,$ErrorAction,[switch]$Force,[switch]$TurnOff) if ($Force -or $TurnOff) { throw 'Power cut is forbidden' }; $script:stops++; $script:state='Off' }
    foreach ($state in @('Off','Running','Paused')) {
        $script:state=$state
        $stopped=& ([scriptblock]::Create($body)) | ConvertFrom-Json
        if (!$stopped.stopped -or $stopped.state -ne 'Off') { throw 'Graceful shutdown did not report the real final state' }
    }
    if ($script:stops -ne 2) { throw 'An already stopped VM should not receive another shutdown' }
    $script:state='Saved'
    try { $null=& ([scriptblock]::Create($body)); throw 'Accepted shutdown of a saved VM' } catch { if ($_.Exception.Message -notlike '*Saved*') { throw } }
    $request.action='start'; $script:state='Running'
    $request.config.profile.runtimeId = [guid]::NewGuid().ToString()
    try { $null = & ([scriptblock]::Create($body)); throw 'Accepted another VM' } catch { if ($_.Exception.Message -notlike '*正式 Runtime 不一致*') { throw } }
    if ($script:starts -ne 2) { throw 'An unowned VM was started' }
    $request.config.profile.runtimeId = $vmId
    function Invoke-Command { param($Session,$ScriptBlock,$ErrorAction) throw 'Guest proxy unavailable' }
    function Start-Sleep { param($Seconds) throw 'Fixture timeout' }
    $closedBefore = $script:closed
    try { $null = & ([scriptblock]::Create($body)); throw 'Accepted failed Guest readiness' } catch { if ($_.Exception.Message -ne 'Fixture timeout') { throw } }
    if ($script:closed -ne $closedBefore + 1) { throw 'A failed readiness probe leaked its session' }
    if ((Get-Content -LiteralPath $recordPath -Raw) -ne $before) { throw 'Startup modified the formal VM checkpoint' }
    $processBody = [IO.File]::ReadAllText((Join-Path $source 'runtime/workbench.ps1'))
    $profilePath = 'C:\Users\CodeSeam\AppData\Local\CodeSeam\Browser\guest\edge\User Data'
    function Get-CimInstance {
        param($ClassName,$Filter)
        return @(
            @{Name='msedge.exe';ProcessId=1;CommandLine=('msedge.exe --user-data-dir="' + $profilePath + '"')},
            @{Name='msedge.exe';ProcessId=2;CommandLine=('msedge.exe --user-data-dir="' + $profilePath + '" --type=renderer')},
            @{Name='msedge.exe';ProcessId=3;CommandLine='msedge.exe --user-data-dir="C:\Users\CodeSeam\personal"'},
            @{Name='claude.exe';ProcessId=4;ParentProcessId=1;ExecutablePath='C:\Users\CodeSeam\.local\bin\claude.exe'},
            @{Name='claude.exe';ProcessId=5;ParentProcessId=4;ExecutablePath='C:\Users\CodeSeam\.local\bin\claude.exe'}
        )
    }
    $processes = & ([scriptblock]::Create($processBody)) $profilePath | ConvertFrom-Json
    if ($processes.web.count -ne 1 -or $processes.code.count -ne 1 -or $processes.desktop.count -ne 0) { throw 'Guest process observation must count only the managed browser and root Claude processes' }
    'PASS: Off/Saved/Paused/Running recovery, desktop wait, failure cleanup and formal VM ownership'
} finally {
    $resolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $testRoot).Path)
    $tempPrefix = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if ($resolved -ne [IO.Path]::GetFullPath($testRoot) -or !$resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected cleanup target' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
