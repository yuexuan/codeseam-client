$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path $env:LOCALAPPDATA 'CodeSeam\Virtual'
$checkpoint = Get-Content -LiteralPath (Join-Path $taskRoot 'checkpoint.json') -Raw | ConvertFrom-Json
$request = @{root=$taskRoot; action='browser_prepare'; config=@{browser=''; action='prepare'; node=$checkpoint.node; timezoneTarget=$checkpoint.timezoneTarget; script=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/browser.ps1')); worker=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/browser_worker.ps1'))}}
$body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/virtual_runtime.ps1'))
$body = $body.Replace('# GUEST_BROWSER', [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/guest_browser.ps1')))
$body = $body.Replace('# GUEST_FUNCTIONS', [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/guest_install.ps1')).TrimStart([char]0xfeff))
$first = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if ($first.profile.runtime -ne 'Virtual' -or $first.profile.runtimeId -ne $checkpoint.vmId) { throw 'Wrong runtime' }
if ($first.profile.verificationStatus -ne 'satisfied' -or $first.profile.baselineStatus -ne 'satisfied') { throw ($first.profile | ConvertTo-Json -Depth 16) }
$second = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if (!$second.reused -or $first.profile.profilePath -ne $second.profile.profilePath) { throw 'Profile not reused' }
if ($second.profile.verificationStatus -ne 'satisfied') { throw ($second.profile | ConvertTo-Json -Depth 16) }
$second | ConvertTo-Json -Depth 8
