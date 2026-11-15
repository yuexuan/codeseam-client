$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path $env:LOCALAPPDATA 'CodeSeam\Virtual'
$checkpoint = Get-Content -LiteralPath (Join-Path $taskRoot 'checkpoint.json') -Raw | ConvertFrom-Json
$request = @{root=$taskRoot; action='browser_prepare'; config=@{browser=''; node=$checkpoint.node; script=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/browser.ps1'))}}
$body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/virtual_runtime.ps1'))
$body = $body.Replace('# GUEST_BROWSER', [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/guest_browser.ps1')))
$first = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if ($first.profile.runtime -ne 'Virtual' -or $first.profile.runtimeId -ne $checkpoint.vmId) { throw 'Wrong runtime' }
$second = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if (!$second.reused -or $first.profile.profilePath -ne $second.profile.profilePath) { throw 'Profile not reused' }
$second | ConvertTo-Json -Depth 8
