$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/browser.ps1'))
$ast = [scriptblock]::Create($source).Ast
foreach ($name in @('Get-ManagedBrowserProcesses','Close-ManagedBrowser')) {
    $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $false)
    . ([scriptblock]::Create($definition.Extent.Text))
}
$testRoot = Join-Path $env:TEMP ('codeseam-close-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testRoot
$managed = Join-Path $testRoot 'Managed Profile'
$sentinel = Join-Path $testRoot 'login-sentinel'
Set-Content -LiteralPath $sentinel -Value 'preserve'
$script:processes = @()
$script:graceful = $true
$script:denied = $false
$script:forced = @()
$script:lease = $null
function Get-CimInstance { param($ClassName,$Filter) return $script:processes }
function Get-Process {
    param($Id)
    if (!($script:processes | Where-Object ProcessId -eq $Id)) { return }
    $process = [pscustomobject]@{Id=$Id}
    $process | Add-Member -MemberType ScriptMethod -Name CloseMainWindow -Value {
        if ($script:graceful) { $script:processes = @($script:processes | Where-Object ProcessId -ne $this.Id) }
        return $script:graceful
    }
    return $process
}
function Stop-Process {
    param($Id,[switch]$Force)
    if ($script:denied) { throw 'fixture access denied' }
    $script:forced += $Id
    $script:processes = @($script:processes | Where-Object ProcessId -ne $Id)
}
function Start-Sleep { param($Milliseconds) if ($script:lease) { $script:lease.Dispose(); $script:lease = $null } }
function Fixture-Processes {
    @(
        [pscustomobject]@{ProcessId=101;CommandLine=('msedge.exe --user-data-dir="' + $managed + '" --new-window https://claude.ai/')},
        [pscustomobject]@{ProcessId=102;CommandLine=('msedge.exe --user-data-dir="' + $managed + '-other"')},
        [pscustomobject]@{ProcessId=103;CommandLine='msedge.exe --profile-directory=Default'},
        [pscustomobject]@{ProcessId=104;CommandLine='chrome.exe --user-data-dir=C:\DailyProfile'}
    )
}
try {
    $script:processes = Fixture-Processes
    Close-ManagedBrowser $managed $testRoot 0 0
    if ($script:processes.Count -ne 3 -or $script:forced.Count) { throw 'Graceful close must target only the exact managed profile' }
    $script:processes = Fixture-Processes
    $script:graceful = $false
    Close-ManagedBrowser $managed $testRoot 0 0
    if ($script:forced.Count -ne 1 -or $script:forced[0] -ne 101 -or $script:processes.Count -ne 3) { throw 'Background managed browser must be stopped without touching unrelated profiles' }
    $script:processes = @([pscustomobject]@{ProcessId=105;CommandLine='msedge.exe --user-data-dir C:\Managed\UserData'})
    Close-ManagedBrowser 'C:\Managed\UserData' $testRoot 0 0
    if ($script:processes.Count) { throw 'Unquoted profile argument must also be recognized' }
    $script:processes = Fixture-Processes
    $script:denied = $true
    $failed = $false
    try { Close-ManagedBrowser $managed $testRoot 0 0 } catch { $failed = $true }
    if (!$failed) { throw 'Close failure must remain retryable and block verification' }
    $script:processes = @()
    $lockPath = Join-Path $testRoot 'browser.lock'
    $script:lease = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    Close-ManagedBrowser $managed $testRoot 0 1
    if ($script:lease) { throw 'Must wait for the previous launcher to release its lease' }
    $script:lease = [IO.File]::Open($lockPath, 'Open', 'ReadWrite', 'None')
    $failed = $false
    try { Close-ManagedBrowser $managed $testRoot 0 0 } catch { $failed = $true }
    if (!$failed) { throw 'A retained lease must not be treated as a successful close' }
    if ((Get-Content -LiteralPath $sentinel) -ne 'preserve') { throw 'Closing must preserve login files' }
    'PASS: graceful/forced managed close, exact profile matching, background processes, denied close, delayed lease release and retained login files'
} finally {
    if ($script:lease) { $script:lease.Dispose() }
    Remove-Item -LiteralPath $sentinel,(Join-Path $testRoot 'browser.lock') -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $testRoot -ErrorAction SilentlyContinue
}
