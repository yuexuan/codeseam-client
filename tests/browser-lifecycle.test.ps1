$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path $env:TEMP ('codeseam-browser-lifecycle-' + [guid]::NewGuid().ToString('N'))
$body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/browser/browser.ps1'))
# 生命周期测试不会访问发行服务，也不会在测试机器上安装软件。
$ast = [Management.Automation.Language.Parser]::ParseInput($body, [ref]$null, [ref]$null)
$versionFunction = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Ensure-BrowserVersion'}, $false)
$body = $body.Replace($versionFunction.Extent.Text, 'function Ensure-BrowserVersion($Browser, $Root) { return @{status="satisfied";version=$Browser.version;stableVersion=$Browser.version;minimumMajor=1;updated=$false} }')
$request = @{root=$taskRoot;browser='';nodeId='fixture';nodeName='Fixture';exitIp='203.0.113.10';runtime='Virtual';runtimeId='test-vm';desktopPath=(Join-Path $taskRoot 'Desktop');desktopUser='fixture';action='prepare';worker='# test worker'}
$request.timezoneTarget = @{windowsId='Singapore Standard Time';ianaId='Asia/Singapore'}
function Get-TimeZone { return @{Id='Singapore Standard Time'} }
$script:observedTimezone = 'Asia/Singapore'
$script:launches = 0
$script:removals = 0
$script:stops = 0
$script:failure = $false
$script:taskArguments = ''
function New-ScheduledTaskAction { param($Execute,$Argument) $script:taskArguments=$Argument; return 'action' }
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel) if ($RunLevel -ne 'Limited' -or $LogonType -ne 'Interactive') { throw 'Browser must use desktop user' }; return 'principal' }
function New-ScheduledTaskSettingsSet { param($ExecutionTimeLimit,$MultipleInstances,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries) return 'settings' }
function Register-ScheduledTask { param($TaskName,$Action,$Principal,$Settings) }
function Unregister-ScheduledTask { param($TaskName,[switch]$Confirm) $script:removals++ }
function Stop-ScheduledTask { param($TaskName) $script:stops++ }
function Start-ScheduledTask {
    param($TaskName)
    $script:launches++
    if ($script:taskArguments -notmatch '-ResultPath "([^"]+)"') { throw 'Missing unique result path' }
    $path = $Matches[1]
    $result = if ($script:busy) { @{ok=$false;busy=$true} } elseif ($script:failure) { @{ok=$false;error='fixture verification failed'} } else {
        @{ok=$true;exitIp='203.0.113.10';measuredAt='fixture';observed=@{language='en-US';timezone=$script:observedTimezone};network=@{dns='fixture'}}
    }
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8
}
$first = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if ($first.profile.verificationStatus -ne 'satisfied' -or $first.profile.baselineStatus -ne 'satisfied' -or $first.profile.confirmed) { throw 'Candidate must be measured and unconfirmed' }
$sentinel = Join-Path $first.profile.profilePath 'login-sentinel'
Set-Content -LiteralPath $sentinel -Value 'preserve'
$request.action = 'confirm'
$script:failure = $true
try { $null = & ([scriptblock]::Create($body)); throw 'Accepted failed recheck' } catch { if ($_.Exception.Message -ne 'fixture verification failed') { throw } }
$failed = Get-Content -LiteralPath (Join-Path $taskRoot 'managed-profile.json') -Raw | ConvertFrom-Json
if ($failed.confirmed -or $failed.baselineStatus -ne 'pending' -or $failed.verificationStatus -ne 'pending') { throw 'Old verification must not unlock completion' }
$script:failure = $false
$confirmed = & ([scriptblock]::Create($body)) | ConvertFrom-Json
$baseline = Get-Content -LiteralPath $confirmed.profile.baselinePath -Raw | ConvertFrom-Json
if (!$confirmed.profile.confirmed -or !$baseline.confirmed -or $script:launches -ne 3) { throw 'Confirmation must remeasure, persist and return confirmed state' }
if ((Get-Content -LiteralPath $sentinel) -ne 'preserve' -or $confirmed.profile.createdAt -ne $first.profile.createdAt) { throw 'Login/profile identity changed' }
$request.action = 'prepare'
$manifestPath = Join-Path $taskRoot 'managed-profile.json'
$beforeReuse = [IO.File]::ReadAllText($manifestPath)
# 同时替换内嵌的关闭操作，确保破坏性重新初始化会使测试失败。
$reuseBody = $body
$reuseAst = [Management.Automation.Language.Parser]::ParseInput($reuseBody, [ref]$null, [ref]$null)
$closer = $reuseAst.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Close-ManagedBrowser'}, $false)
$reuseBody = $reuseBody.Replace($closer.Extent.Text, "function Close-ManagedBrowser { throw 'Reentry must not close the browser' }")
$restored = & ([scriptblock]::Create($reuseBody)) | ConvertFrom-Json
if (!$restored.profile.confirmed -or !$restored.reused -or $script:launches -ne 3 -or [IO.File]::ReadAllText($manifestPath) -ne $beforeReuse) { throw 'Reentry reset or reverified an unchanged environment' }
$request.action = 'open'
$opened = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if (!$opened.opened -or $script:stops -ne 3 -or $script:removals -ne 4) { throw 'Open must survive controller cleanup, verify tasks must stop' }
$request.action = 'inspect'
$inspected = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if (!$inspected.opened -or $script:taskArguments -notmatch '-Mode inspect' -or $script:stops -ne 3 -or $script:removals -ne 5) { throw 'IP inspection must use a persistent managed browser in inspect mode' }
$request.action = 'verify'
$script:busy = $true
$beforeBusy = [IO.File]::ReadAllText($manifestPath)
$busyResult = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if (!$busyResult.busy -or $busyResult.verified -or [IO.File]::ReadAllText($manifestPath) -ne $beforeBusy) { throw 'An occupied browser must keep its last verification and remain usable' }
$script:busy = $false
$request.action = 'inspect'
$request.nodeId = 'different-node'
try { $null = & ([scriptblock]::Create($body)); throw 'Accepted stale node' } catch { if ($_.Exception.Message -eq 'Accepted stale node') { throw } }
$request.nodeId = 'fixture'
$request.action = 'prepare'
$request.exitIp = '203.0.113.11'
$script:observedTimezone = 'America/Los_Angeles'
$mismatch = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if ($mismatch.profile.timezoneStatus -ne 'pending' -or $mismatch.profile.parametersStatus -eq 'satisfied' -or $mismatch.profile.baselineStatus -eq 'satisfied' -or !$mismatch.profile.verificationError) { throw 'Wrong browser timezone must not produce a successful baseline' }
if ((Get-Content -LiteralPath $sentinel) -ne 'preserve') { throw 'Timezone repair must preserve login data' }
$parseErrors = $null
$null = [Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/browser/browser_worker.ps1')), [ref]$null, [ref]$parseErrors)
if ($parseErrors) { throw ($parseErrors | Out-String) }
'PASS: candidate, failed recheck, confirmed baseline, preserved login, managed open, stale node and worker syntax'
