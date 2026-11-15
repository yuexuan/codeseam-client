$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path ([IO.Path]::GetTempPath()) ('codeseam-browser-test-' + [guid]::NewGuid().ToString('N'))
$request = @{ root = $taskRoot; browser = ''; nodeId = 'fixture'; nodeName = 'Fixture node' }
$scriptPath = Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/browser.ps1'
$first = (& ([scriptblock]::Create([IO.File]::ReadAllText($scriptPath, [Text.Encoding]::UTF8))) | ConvertFrom-Json)
if ($first.reused -or !(Test-Path -LiteralPath $first.profile.profilePath)) { throw 'Profile not created' }
$sentinel = Join-Path $first.profile.profilePath 'session-sentinel'
Set-Content -LiteralPath $sentinel -Value 'preserve-login'
$second = (& ([scriptblock]::Create([IO.File]::ReadAllText($scriptPath, [Text.Encoding]::UTF8))) | ConvertFrom-Json)
if (!$second.reused -or (Get-Content -LiteralPath $sentinel) -ne 'preserve-login') { throw 'Profile data not preserved' }
if ($second.profile.profileId -ne $first.profile.profileId -or $second.profile.createdAt -ne $first.profile.createdAt) { throw 'Profile identity changed' }
if ($second.profile.proxyStatus -ne 'pending' -or $second.profile.verificationStatus -ne 'pending') { throw 'Unverified result claimed success' }
Write-Output "PASS: creation, reuse, login preservation and pending verification ($taskRoot)"
