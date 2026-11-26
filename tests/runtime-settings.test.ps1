# 使用模拟的操作系统函数运行，不会修改系统设置。
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/network/system_network.ps1') -Raw -Encoding UTF8
$source = $source.Replace("`r`n", "`n")
$functions = $source.Substring(0, $source.IndexOf("`ntry {`n    if(`$Request.op"))
. ([scriptblock]::Create($functions))

$Request = [pscustomobject]@{action='set_timezone';timezone='Singapore Standard Time';before=[pscustomobject]@{timezone='China Standard Time'}}
$script:current='China Standard Time'
function Get-State { [pscustomobject]@{timezone=$script:current} }
function Set-TimeZone { param($Id) $script:current=$Id }
Check-Guard (Get-State) $false
Set-TimeZone -Id $Request.timezone
Verify-Settings (Get-State) $false
Restore-Settings
Verify-Settings (Get-State) $true
if($script:current -ne 'China Standard Time'){throw 'restore failed'}
$script:current='UTC'
$blocked=$false
try { Check-Guard (Get-State) $true } catch { $blocked=$true }
if(!$blocked){throw 'conflicting timezone was not rejected'}
Write-Output 'PASS: timezone apply, verify, restore and concurrent-change guard (mocked OS)'

$Request=[pscustomobject]@{action='enable_time_sync';before=[pscustomobject]@{timeSync=[pscustomobject]@{running=$false;startMode='Manual'}}}
$script:running=$false; $script:startMode='Manual'
function Get-State { [pscustomobject]@{timeSync=[pscustomobject]@{running=$script:running;startMode=$script:startMode}} }
function Set-Service { param($Name,$StartupType) $script:startMode=switch($StartupType){'Automatic'{'Auto'} 'Manual'{'Manual'} 'Disabled'{'Disabled'}} }
function Start-Service { param($Name) $script:running=$true }
function Stop-Service { param($Name,[switch]$Force) $script:running=$false }
Check-Guard (Get-State) $false
Set-Service W32Time -StartupType Automatic
Start-Service W32Time
Verify-Settings (Get-State) $false
Restore-Settings
Verify-Settings (Get-State) $true
$script:startMode='Disabled'
$blocked=$false
try { Check-Guard (Get-State) $true } catch { $blocked=$true }
if(!$blocked){throw 'conflicting time service state was not rejected'}
Write-Output 'PASS: time service verify, restore and concurrent-change guard (mocked OS)'
