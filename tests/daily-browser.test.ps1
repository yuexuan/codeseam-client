$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('codeseam-daily-browser-' + [guid]::NewGuid().ToString('N'))
$profilePath = Join-Path $root 'chrome/User Data'
$null = New-Item -ItemType Directory -Path $profilePath -Force
$manifestPath = Join-Path $root 'managed-profile.json'
$launcher = Join-Path $root 'launcher.ps1'
$sentinel = Join-Path $profilePath 'login-sentinel'
$exe = (Get-Process -Id $PID).Path
$profile = @{profileId='fixture-chrome';runtimeId='fixture';browserId='chrome';profilePath=$profilePath;nodeId='fixture-node';targetTimezone='Asia/Singapore';verification=@{exitIp='203.0.113.10'}}
$manifest = @{} + $profile
$manifest.executable=$exe
$manifest.version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
$manifest.expectedExitIp='203.0.113.10'
$manifest.language=(Get-Culture).Name
$manifest.timezone=(Get-TimeZone).Id
$manifest.verification=@{ok=$true;exitIp='203.0.113.10';observed=@{timezone='Asia/Singapore'}}
$manifest.verificationStatus='satisfied'
$manifest.confirmed=$true
$manifest.shortcutPath=Join-Path $root 'Claude.lnk'
function Save-Fixture { $manifest | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $manifestPath -Encoding UTF8 }
$snapshot = [scriptblock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/browser/daily_browser.ps1')))
try {
    Save-Fixture
    Set-Content -LiteralPath $sentinel -Value 'login-retained'
    $before=[IO.File]::ReadAllText($manifestPath)
    $result = & $snapshot 'read_browser' $profile $false ''
    if (!$result.browserData.baselineMatches -or !$result.browserData.profileExists -or $result.browserData.shortcutValid -or $result.browserData.lastLaunched) { throw 'Snapshot must read actual installation and never invent shortcut or launch evidence' }
    if ([IO.File]::ReadAllText($manifestPath) -ne $before -or (Get-Content -LiteralPath $sentinel) -ne 'login-retained') { throw 'Read must preserve manifest and login data byte-for-byte' }
    $manifest.version='stale'; Save-Fixture
    if ((& $snapshot 'read_browser' $profile $false '').browserData.baselineMatches) { throw 'Changed version must invalidate current evidence' }
    $manifest.runtimeId='another-runtime'; Save-Fixture
    try { $null=& $snapshot 'read_browser' $profile $false ''; throw 'Accepted another Runtime' } catch { if ($_.Exception.Message -notlike '*身份与正式 Runtime 不一致*') { throw } }
    $manifest.runtimeId='fixture'; Save-Fixture
    $body=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/browser/browser.ps1'))
    $branch=([scriptblock]::Create($body)).Ast.FindAll({param($n) $n -is [Management.Automation.Language.IfStatementAst]},$true) | Where-Object { $_.Clauses[0].Item1.Extent.Text -eq '$request.action -eq ''verify''' -and $_.Clauses[0].Item2.Extent.Text.Contains('$outputPath') } | Select-Object -First 1
    if (!$branch) { throw 'Missing daily verification branch' }
    $request=@{action='verify';nodeId='fixture-node';exitIp='203.0.113.10';worker='fixture worker'}
    $prior=[pscustomobject]$manifest; $target=@{ianaId='Asia/Singapore'}
    function Save-Profile { $manifest | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $manifestPath -Encoding UTF8 }
    $script:failProbe=$false
    function Start-BrowserTask { param($Mode,$OutputPath) if($Mode -ne 'verify') {throw 'Wrong probe mode'}; if($script:failProbe) {return @{ok=$false;error='fixture probe failed'}}; return @{ok=$true;exitIp='203.0.113.10';observed=@{timezone='Asia/Singapore'};measuredAt='fixture'} }
    $null=& ([scriptblock]::Create($branch.Extent.Text))
    $updated=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($updated.verificationStatus -ne 'satisfied' -or !$updated.confirmed) {throw 'Reverify must preserve formal confirmation and update only probe evidence'}
    $script:failProbe=$true
    try {$null=& ([scriptblock]::Create($branch.Extent.Text));throw 'Accepted failed probe'} catch {if($_.Exception.Message -ne 'fixture probe failed') {throw}}
    $updated=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($updated.verificationStatus -ne 'pending' -or !$updated.verificationError -or (Get-Content -LiteralPath $sentinel) -ne 'login-retained') {throw 'Failed probe must invalidate status and preserve login data'}
    'PASS: read-only snapshot, missing evidence, version drift, Runtime identity, successful and failed reverify, preserved login and formal confirmation'
} finally {
    # 仅删除本测试创建的文件，不递归清理配置目录。
    foreach ($file in @($manifestPath,$launcher,$sentinel)) {if(Test-Path -LiteralPath $file) {Remove-Item -LiteralPath $file}}
    Remove-Item -LiteralPath $profilePath
    Remove-Item -LiteralPath (Split-Path $profilePath)
    Remove-Item -LiteralPath $root
}
