# 显式实时探测：检查现有虚拟机并打开或复用其控制台。
# 不会安装 Windows 或重建虚拟机，也不属于无人值守 CI。
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../src-tauri/src/infrastructure'
$body = [IO.File]::ReadAllText((Join-Path $source 'virtual_runtime.ps1')).TrimStart([char]0xfeff)
$body = $body.Replace('# GUEST_FUNCTIONS', [IO.File]::ReadAllText((Join-Path $source 'guest_install.ps1')).TrimStart([char]0xfeff))
$body = $body.Replace('# GUEST_BROWSER', [IO.File]::ReadAllText((Join-Path $source 'guest_browser.ps1')).TrimStart([char]0xfeff))
$body = $body.Replace('# CONSOLE_DISPLAY', [IO.File]::ReadAllText((Join-Path $source 'console_display.ps1')))
$request = @{root=(Join-Path $env:LOCALAPPDATA 'CodeSeam\Virtual'); action='ensure_ready'; config=@{openConsole=$true}}
$checkpoint = Get-Content -LiteralPath (Join-Path $request.root 'checkpoint.json') -Raw | ConvertFrom-Json
$request.config.node = $checkpoint.node
$request.config.timezoneTarget = $checkpoint.timezoneTarget
$timer = [Diagnostics.Stopwatch]::StartNew()
$result = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if (!$result.ready -or !$result.consoleOpened -or !$result.consoleProcessId) { throw 'Guest/console readiness was not confirmed' }
if (!(Get-Process -Id $result.consoleProcessId -ErrorAction SilentlyContinue)) { throw 'Console exited with the controller' }
@{result=$result; elapsedSeconds=$timer.Elapsed.TotalSeconds; consoleStillRunning=$true} | ConvertTo-Json -Depth 4
