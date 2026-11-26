$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/environment/reset.ps1'))
$ast = [scriptblock]::Create($source).Ast
# 在进程内通过模拟 Hyper-V 验证控制器，不提权，也不操作真实虚拟机。
$elevation = $ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text.StartsWith('if (!$admin') } | Select-Object -First 1
if (!$elevation) { throw 'Missing elevation branch in reset fixture' }
function Start-Process { throw 'Isolated reset test cannot invoke a child process' }
$source = $source.Remove($elevation.Extent.StartOffset, $elevation.Extent.EndOffset - $elevation.Extent.StartOffset)
$controller = [scriptblock]::Create($source)
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('codeseam-reset-test-' + [guid]::NewGuid().ToString('N'))
function Import-Module { param($Name, $ErrorAction) if ($Name -ne 'Hyper-V') { throw 'Unexpected module' } }
function Get-VM { param($Id, $ErrorAction) return $script:fixtureVM }
function Get-VMHardDiskDrive { param($VM) return @{Path=(Join-Path $VM.Path 'system.vhdx')} }
function Get-ScheduledTask { param($TaskName, $ErrorAction) return $null }
function Stop-VM { param($VM, [switch]$TurnOff, [switch]$Force) $script:stopped = $true }
function Remove-VM { param($VM, [switch]$Force) $script:removed = $true }
function Export-VM {
    param($VM, $Path)
    if ($script:failExport) { throw 'fixture export failure' }
    $null = New-Item -ItemType Directory -Path $Path -Force
    [IO.File]::WriteAllText((Join-Path $Path 'export.fixture'), 'exported')
}
try {
    foreach ($mode in @('export-failure','backup','no-backup','foreign-path')) {
        $root = Join-Path $testRoot $mode
        $vmPath = Join-Path $root 'Virtual/fixture-vm'
        $null = New-Item -ItemType Directory -Path $vmPath -Force
        [IO.File]::WriteAllText((Join-Path $vmPath 'system.vhdx'), 'disk fixture')
        [IO.File]::WriteAllText((Join-Path $root 'Virtual/checkpoint.json'), '{"vmId":"00000000-0000-0000-0000-000000000001"}')
        $script:fixtureVM = @{Path=$vmPath; State='Running'}
        $script:failExport = $mode -eq 'export-failure'
        $script:stopped = $false; $script:removed = $false
        $backup = if ($mode -ne 'no-backup') { Join-Path $root 'ResetBackups/fixture' } else { $null }
        if ($backup) { $null = New-Item -ItemType Directory -Path $backup -Force }
        if ($mode -eq 'foreign-path') { $script:fixtureVM.Path = Join-Path $testRoot 'external' }
        $request = @{root=$root; local=$false; virtual=$true; backup=$backup}
        $caught = $null
        try { $null = & $controller } catch { $caught = $_ }
        if ($mode -in @('export-failure','foreign-path')) {
            if (!$caught -or $script:removed -or !(Test-Path -LiteralPath $vmPath)) { throw "Failure must preserve VM and disk: $mode" }
        } else {
            if ($caught) { throw $caught }
            if (!$script:removed -or !$script:stopped -or (Test-Path -LiteralPath $vmPath)) { throw "VM reset did not complete: $mode" }
            if ($backup -and !(Test-Path -LiteralPath (Join-Path $backup 'VMExport/export.fixture'))) { throw 'Missing exported VM' }
        }
    }
    'PASS: virtual reset backup, no-backup, export failure and external-path protection'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    if (!$resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
