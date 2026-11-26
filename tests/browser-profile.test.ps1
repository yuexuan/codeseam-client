$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path ([IO.Path]::GetTempPath()) ('codeseam-browser-test-' + [guid]::NewGuid().ToString('N'))
$request = @{ root = $taskRoot; browser = ''; nodeId = 'fixture'; nodeName = 'Fixture node' }
$request.timezoneTarget = @{windowsId=(Get-TimeZone).Id;ianaId='fixture-timezone'}
$scriptPath = Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/browser/browser.ps1'
$body = [IO.File]::ReadAllText($scriptPath, [Text.Encoding]::UTF8)
$ast = [Management.Automation.Language.Parser]::ParseInput($body, [ref]$null, [ref]$null)
$versionFunction = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Ensure-BrowserVersion'}, $false)
$body = $body.Replace($versionFunction.Extent.Text, 'function Ensure-BrowserVersion($Browser, $Root) { return @{status="satisfied";version=$Browser.version;stableVersion=$Browser.version;minimumMajor=1;updated=$false} }')
$first = (& ([scriptblock]::Create($body)) | ConvertFrom-Json)
if ($first.reused -or !(Test-Path -LiteralPath $first.profile.profilePath)) { throw 'Profile not created' }
$sentinel = Join-Path $first.profile.profilePath 'session-sentinel'
Set-Content -LiteralPath $sentinel -Value 'preserve-login'
$second = (& ([scriptblock]::Create($body)) | ConvertFrom-Json)
if (!$second.reused -or (Get-Content -LiteralPath $sentinel) -ne 'preserve-login') { throw 'Profile data not preserved' }
if ($second.profile.profileId -ne $first.profile.profileId -or $second.profile.createdAt -ne $first.profile.createdAt) { throw 'Profile identity changed' }
if ($second.profile.proxyStatus -ne 'pending' -or $second.profile.verificationStatus -ne 'pending') { throw 'Unverified result claimed success' }
Write-Output "PASS: creation, reuse, login preservation and pending verification ($taskRoot)"
