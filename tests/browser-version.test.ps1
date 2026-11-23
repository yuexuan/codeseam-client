$ErrorActionPreference = 'Stop'
$body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/browser.ps1'))
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($body, [ref]$null, [ref]$parseErrors)
if ($parseErrors) { throw ($parseErrors | Out-String) }
foreach ($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
$browser = @{id='edge';name='Microsoft Edge';path='fixture.exe'}
$script:installed = [version]'92.0.902.67'
$script:installs = 0
$script:serviceDown = $false
$script:installFails = $false
$script:unchanged = $false
function Get-BrowserVersion { param($Path) return $script:installed }
function Get-BrowserRelease {
    param($Kind)
    if ($script:serviceDown) { throw 'offline' }
    return @{version=[version]'157.0.4341.60'}
}
$realInstall = ${function:Install-BrowserUpdate}
function Install-BrowserUpdate {
    param($Browser, $Release, $Root)
    $script:installs++
    if ($script:installFails) { throw 'installer failed' }
    if (!$script:unchanged) { $script:installed=$Release.version }
}
function Expect-Failure([scriptblock]$Action, [string]$Pattern) {
    try { & $Action; throw 'Expected failure was accepted' }
    catch { if ($_.Exception.Message -notmatch $Pattern) { throw } }
}
$result = Ensure-BrowserVersion $browser 'fixture'
if (!$result.updated -or $result.status -ne 'satisfied' -or $result.minimumMajor -ne 157 -or $script:installs -ne 1 -or $result.version -ne '157.0.4341.60') { throw 'Edge 92 must upgrade and re-read installed version' }
$result = Ensure-BrowserVersion $browser 'fixture'
if ($result.updated -or $script:installs -ne 1) { throw 'Current stable must not reinstall' }
$script:installed = [version]'158.0.1.2'
$null = Ensure-BrowserVersion $browser 'fixture'
if ($script:installs -ne 1) { throw 'Newer browser must never downgrade' }
$script:installed = [version]'92.0.902.67'
$script:unchanged = $true
Expect-Failure { Ensure-BrowserVersion $browser 'fixture' } '升级后仍为'
$script:installFails = $true
Expect-Failure { Ensure-BrowserVersion $browser 'fixture' } '已有 Profile 已保留'
$script:serviceDown = $true
$attempts = $script:installs
Expect-Failure { Ensure-BrowserVersion $browser 'fixture' } '无法校对'
if ($script:installs -ne $attempts) { throw 'Unknown release must not install or claim compatibility' }

# 验证实际安装程序辅助函数，但不下载或运行安装程序。
${function:Install-BrowserUpdate} = $realInstall
$script:running = $true
function Get-Process { param($Name) if ($script:running) { return @{Id=123} } }
Expect-Failure { Install-BrowserUpdate $browser @{url='https://dl.google.com/update.msi'} 'fixture' } '请先关闭'
$script:running = $false
Expect-Failure { Install-BrowserUpdate $browser @{url='http://dl.google.com/update.msi'} 'fixture' } '官方 HTTPS'
Expect-Failure { Install-BrowserUpdate $browser @{url='https://microsoft.com.evil.test/update.msi'} 'fixture' } '官方 HTTPS'
$script:signatureStatus = 'Invalid'
$script:downloadHash = 'bad'
function New-Item { param($ItemType,$Path,[switch]$Force) }
function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) }
function Get-FileHash { param($LiteralPath,$Algorithm) return @{Hash=$script:downloadHash} }
function Get-AuthenticodeSignature { param($LiteralPath) return @{Status=$script:signatureStatus;SignerCertificate=@{Subject='CN=Other, O=Other Company, C=US'}} }
function Remove-Item { param($LiteralPath) }
function Start-Process { throw 'Unverified installer must never start' }
Expect-Failure { Install-BrowserUpdate $browser @{url='https://dl.google.com/update.msi';hash='expected'} 'fixture' } 'SHA256'
Expect-Failure { Install-BrowserUpdate $browser @{url='https://dl.google.com/update.msi';publisher='Google LLC'} 'fixture' } '官方签名'
$script:signatureStatus = 'Valid'
Expect-Failure { Install-BrowserUpdate $browser @{url='https://dl.google.com/update.msi';publisher='Google LLC'} 'fixture' } '官方签名'
function Get-AuthenticodeSignature { param($LiteralPath) return @{Status='Valid';SignerCertificate=@{Subject='CN=Google LLC, O=Google LLC, C=US'}} }
$script:exitCode = 0
$script:finishes = $true
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru,$Verb)
    if ($FilePath -notlike '*msiexec.exe' -or $ArgumentList -notcontains '/norestart' -or $WindowStyle -ne 'Hidden') { throw 'Invalid installer invocation' }
    $process = [pscustomobject]@{ExitCode=$script:exitCode}
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Timeout) if ($Timeout -ne 240000) { throw 'Missing bounded installer wait' }; return $script:finishes }
    return $process
}
Install-BrowserUpdate $browser @{url='https://dl.google.com/update.msi';publisher='Google LLC'} 'fixture'
$script:exitCode = 1603
Expect-Failure { Install-BrowserUpdate $browser @{url='https://dl.google.com/update.msi';publisher='Google LLC'} 'fixture' } '1603'
$script:exitCode = 3010
Expect-Failure { Install-BrowserUpdate $browser @{url='https://dl.google.com/update.msi';publisher='Google LLC'} 'fixture' } '需要重启'
$script:finishes = $false
Expect-Failure { Install-BrowserUpdate $browser @{url='https://dl.google.com/update.msi';publisher='Google LLC'} 'fixture' } '仍在运行'
'PASS: old/current/newer versions, upgrade recheck, offline/failed upgrades, running browsers, official HTTPS, hashes and publisher signatures'
