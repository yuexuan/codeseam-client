$ErrorActionPreference = 'Stop'
. ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/hyperv/guest_install.ps1'))))
$script:current = 'Pacific Standard Time'
$script:sets = 0
$script:applyWorks = $true
function Invoke-Command { param($Session,[object[]]$ArgumentList,$ScriptBlock) if ($Session -ne 'fixture') { throw 'Wrong Guest session' }; & $ScriptBlock @ArgumentList }
function Get-TimeZone {
    param($Id)
    if ($Id) {
        if ($Id -notin @('Singapore Standard Time','Tokyo Standard Time')) { throw 'Unsupported timezone' }
        return @{Id=$Id}
    }
    return @{Id=$script:current}
}
function Set-TimeZone { param($Id) $script:sets++; if ($script:applyWorks) { $script:current = $Id } }
$singapore = @{windowsId='Singapore Standard Time';ianaId='Asia/Singapore'}
$actual = Sync-GuestTimezone 'fixture' $singapore
if ($actual -ne 'Singapore Standard Time' -or $script:sets -ne 1) { throw 'Image timezone must be corrected to the selected Singapore exit' }
$actual = Sync-GuestTimezone 'fixture' $singapore
if ($script:sets -ne 1) { throw 'Already matching timezone should not be rewritten' }
$actual = Sync-GuestTimezone 'fixture' @{windowsId='Tokyo Standard Time';ianaId='Asia/Tokyo'}
if ($actual -ne 'Tokyo Standard Time' -or $script:sets -ne 2) { throw 'Reusing a Guest must follow a different selected timezone' }
function Expect-Failure([scriptblock]$Action) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    if (!$failed) { throw 'Invalid or unapplied timezone was accepted' }
}
$script:applyWorks = $false
Expect-Failure { Sync-GuestTimezone 'fixture' $singapore }
Expect-Failure { Sync-GuestTimezone 'fixture' $null }
Expect-Failure { Sync-GuestTimezone 'fixture' @{windowsId='unknown';ianaId='unknown'} }
'PASS: Guest timezone follows selected exit, repairs reused images, verifies the applied value and rejects unknown/failed targets'
