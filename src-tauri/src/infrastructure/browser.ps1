$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$available = @()
foreach ($kind in @('edge', 'chrome')) {
    $relative = if ($kind -eq 'edge') { 'Microsoft\Edge\Application\msedge.exe' } else { 'Google\Chrome\Application\chrome.exe' }
    foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
        if (!$base) { continue }
        $candidate = Join-Path $base $relative
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $available += [pscustomobject]@{ id = $kind; name = $(if ($kind -eq 'edge') { 'Microsoft Edge' } else { 'Google Chrome' }); path = $candidate; version = (Get-Item -LiteralPath $candidate).VersionInfo.ProductVersion }
            break
        }
    }
}
$root = [string]$request.root
$manifestPath = Join-Path $root 'managed-profile.json'
$prior = if (Test-Path -LiteralPath $manifestPath) { Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } else { $null }
if ($prior -and $prior.schema -ne 1) { throw 'Profile 配置版本无法识别，原数据已保留。' }
$chosen = [string]$request.browser
if (!$chosen -and $prior) { $chosen = $prior.browserId }
$selected = $available | Where-Object { !$chosen -or $_.id -eq $chosen } | Select-Object -First 1
if (!$selected) { throw '未发现可用的 Chrome / Edge。请从浏览器官方网站安装后重新检测；已有 Profile 已保留。' }
# 每种浏览器使用独立的数据目录，不能用 Chrome 打开 Edge 配置文件。
$profile = Join-Path $root ($selected.id + '\User Data')
$reused = Test-Path -LiteralPath $profile -PathType Container
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$runtime = if ($request.runtime) { [string]$request.runtime } else { 'Native' }
$runtimeId = if ($request.runtimeId) { [string]$request.runtimeId } else { 'native' }
$manifest = [ordered]@{ schema = 1; profileId = ($runtimeId + '-' + $selected.id); profileName = 'Claude (CodeSeam)'; profilePath = $profile; browserId = $selected.id; browserName = $selected.name; executable = $selected.path; version = $selected.version; runtime = $runtime; runtimeId = $runtimeId; nodeId = $request.nodeId; nodeName = $request.nodeName; createdAt = $(if ($prior -and $prior.browserId -eq $selected.id) { $prior.createdAt } else { [DateTime]::UtcNow.ToString('o') }); language = (Get-Culture).Name; timezone = (Get-TimeZone).Id; proxyStatus = 'pending'; shortcutStatus = 'pending'; verificationStatus = 'pending' }
$temp = $manifestPath + '.tmp'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temp -Encoding UTF8
Move-Item -LiteralPath $temp -Destination $manifestPath -Force
@{ profile = $manifest; available = @($available); reused = [bool]$reused } | ConvertTo-Json -Depth 8 -Compress
