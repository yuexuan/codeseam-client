$ErrorActionPreference = 'Stop'
$body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/guest_browser.ps1'))
$root = $env:TEMP
$recordPath = 'checkpoint.json'
$id = [guid]::NewGuid().ToString()
$request = @{ action='ensure_ready'; config=@{openConsole=$true} }
$script:launches = 0
$script:closed = 0
function Get-Content {
    param($LiteralPath, [switch]$Raw)
    if ($LiteralPath -eq $recordPath) { return (@{phase='guest'; deployed=$true; name='candidate'; vmId=$id} | ConvertTo-Json) }
    return (@{ready=$true; name='candidate'} | ConvertTo-Json)
}
function Get-VM { param($Id) return @{State='Running'} }
function Import-Clixml { param($LiteralPath) return 'credential' }
function New-PSSession { param($VMId,$Credential) return 'session' }
function Test-GuestDesktop { param($Session) return $true }
function Invoke-Command { param($Session,$ScriptBlock) }
function Remove-PSSession { param($Session) $script:closed++ }
function Test-Path { param($LiteralPath,$PathType) return $true }
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle)
    if ($FilePath -notlike '*vmconnect.exe' -or $WindowStyle -ne 'Normal' -or $ArgumentList[2] -ne $id) { throw 'Wrong console target or visibility' }
    $script:launches++
}
$result = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if (!$result.ready -or $script:launches -ne 1 -or $script:closed -ne 1) { throw 'Next must open the VM console and close the Guest session' }
$request.config.openConsole = $false
$null = & ([scriptblock]::Create($body))
if ($script:launches -ne 1) { throw 'Background readiness checks must not open another console' }
'PASS: Next opens the target VM visibly; background checks do not open windows'
