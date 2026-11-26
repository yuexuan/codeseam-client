param([string]$Action, $Profile, [bool]$Virtual, [string]$Worker)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path ([string]$Profile.profilePath))
$manifestPath = Join-Path $root 'managed-profile.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.profileId -ne $Profile.profileId -or $manifest.runtimeId -ne $Profile.runtimeId -or $manifest.profilePath -ne $Profile.profilePath -or $manifest.browserId -ne $Profile.browserId) { throw '专用 Profile 身份与正式 Runtime 不一致，已停止读取。' }
$exists = Test-Path -LiteralPath $manifest.profilePath -PathType Container
$version = if (Test-Path -LiteralPath $manifest.executable -PathType Leaf) { (Get-Item -LiteralPath $manifest.executable).VersionInfo.ProductVersion } else { $null }
$shortcutValid = $false
if ($manifest.shortcutPath -and (Test-Path -LiteralPath $manifest.shortcutPath -PathType Leaf)) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($manifest.shortcutPath)
    $launcher = Join-Path $root 'launcher.ps1'
    $expected = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcutValid = $shortcut.TargetPath -eq $expected -and $shortcut.Arguments -eq ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Mode open') -and (Test-Path -LiteralPath $launcher -PathType Leaf)
}
$matches = $exists -and $version -eq $manifest.version -and $manifest.nodeId -eq $Profile.nodeId -and $manifest.expectedExitIp -eq $Profile.verification.exitIp -and $manifest.targetTimezone -eq $Profile.targetTimezone -and $manifest.verification.observed.timezone -eq $manifest.targetTimezone -and $manifest.timezone -eq (Get-TimeZone).Id -and $manifest.language -eq (Get-Culture).Name
$launchPath = Join-Path $root 'last-launch.json'
$launched = if (Test-Path -LiteralPath $launchPath) { (Get-Content -LiteralPath $launchPath -Raw | ConvertFrom-Json).at } else { $null }
@{browserData=@{profile=$manifest; installedVersion=$version; profileExists=$exists; shortcutValid=$shortcutValid; lastLaunched=$launched; baselineMatches=[bool]$matches; error=$(if (!$exists) {'专用 Profile 目录不存在，请重新创建。'} elseif (!$version) {'未检测到绑定的浏览器，请安装后重新创建。'} elseif (!$matches) {'浏览器版本或环境配置已变化，请重新验证。'} else {$null})}}
