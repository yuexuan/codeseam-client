$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Get-BrowserVersion([string]$Path) {
    $value = (Get-Item -LiteralPath $Path).VersionInfo.ProductVersion
    $parsed = $null
    if (![version]::TryParse($value, [ref]$parsed)) { throw ('无法识别浏览器版本：' + $value) }
    return $parsed
}
function Get-BrowserRelease([string]$Kind) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $architecture = switch ($architecture) { 'ARM64' { 'arm64' } 'AMD64' { 'x64' } default { 'x86' } }
    if ($Kind -eq 'edge') {
        $products = Invoke-RestMethod 'https://edgeupdates.microsoft.com/api/products?view=enterprise' -TimeoutSec 20
        $release = $products | Where-Object Product -eq 'Stable' | ForEach-Object { $_.Releases } |
            Where-Object { $_.Platform -eq 'Windows' -and $_.Architecture -eq $architecture } |
            Sort-Object { [version]$_.ProductVersion } -Descending | Select-Object -First 1
        $artifact = $release.Artifacts | Where-Object ArtifactName -eq 'msi' | Select-Object -First 1
        if (!$release -or !$artifact -or $artifact.HashAlgorithm -ne 'SHA256' -or $artifact.Hash -notmatch '^[a-fA-F0-9]{64}$') { throw '微软版本服务未返回有效的稳定版安装包。' }
        return @{ version=[version]$release.ProductVersion; url=$artifact.Location; hash=$artifact.Hash; publisher='Microsoft Corporation' }
    }
    $data = Invoke-RestMethod 'https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions?page_size=1&order_by=version%20desc' -TimeoutSec 20
    $version = [version]$data.versions[0].version
    $filename = switch ($architecture) { 'arm64' { 'googlechromestandaloneenterprise_arm64.msi' } 'x64' { 'googlechromestandaloneenterprise64.msi' } default { 'googlechromestandaloneenterprise.msi' } }
    return @{ version=$version; url=('https://dl.google.com/dl/chrome/install/' + $filename); publisher='Google LLC' }
}
function Install-BrowserUpdate($Browser, $Release, [string]$Root) {
    $processName = if ($Browser.id -eq 'edge') { 'msedge' } else { 'chrome' }
    if (Get-Process -Name $processName -ErrorAction SilentlyContinue) { throw ('请先关闭当前运行环境中的 ' + $Browser.name + ' 窗口，再点击重新检测以升级。') }
    $uri = [uri]$Release.url
    if ($uri.Scheme -ne 'https' -or !($uri.Host -eq 'dl.google.com' -or $uri.Host.EndsWith('.microsoft.com'))) { throw '浏览器安装包地址不是受信任的官方 HTTPS 地址。' }
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
    $installer = Join-Path $Root ('browser-update-' + [guid]::NewGuid().ToString('N') + '.msi')
    $installerRunning = $false
    try {
        Invoke-WebRequest -Uri $uri.AbsoluteUri -OutFile $installer -UseBasicParsing -TimeoutSec 180 | Out-Null
        if ($Release.hash -and (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $Release.hash) { throw '浏览器安装包 SHA256 校验失败。' }
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch ('(?:^|,\s*)O="?' + [regex]::Escape($Release.publisher) + '"?(?:,|$)')) { throw '浏览器安装包官方签名校验失败。' }
        $start = @{FilePath=(Join-Path $env:SystemRoot 'System32\msiexec.exe'); ArgumentList=@('/i', ('"' + $installer + '"'), '/qn', '/norestart'); WindowStyle='Hidden'; PassThru=$true}
        $identity = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        if (!$identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { $start.Verb = 'RunAs' }
        $process = Start-Process @start
        $installerRunning = $true
        if (!$process.WaitForExit(240000)) { throw '浏览器升级仍在运行，请等待安装结束后重新检测。' }
        $installerRunning = $false
        if ($process.ExitCode -eq 3010) { throw '浏览器升级需要重启当前运行环境，请重启后重新检测。' }
        if ($process.ExitCode -ne 0) { throw ('浏览器安装程序返回 ' + $process.ExitCode + '，请从官方网站完成升级后重新检测。') }
    } finally {
        if (!$installerRunning) { Remove-Item -LiteralPath $installer -ErrorAction SilentlyContinue }
    }
}
function Ensure-BrowserVersion($Browser, [string]$Root) {
    $installed = Get-BrowserVersion $Browser.path
    try { $release = Get-BrowserRelease $Browser.id }
    catch { throw ('无法校对 ' + $Browser.name + ' ' + $installed + ' 的官方稳定版，请检查网络后重新检测。' + $_.Exception.Message) }
    # CodeSeam freshness policy, not an assertion of Claude's minimum supported version.
    $updated = $false
    if ($installed.Major -lt $release.version.Major) {
        try { Install-BrowserUpdate $Browser $release $Root }
        catch { throw ($Browser.name + ' ' + $installed + ' 版本过旧，需升级至当前稳定版 ' + $release.version + '。' + $_.Exception.Message + ' 已有 Profile 已保留。') }
        $installed = Get-BrowserVersion $Browser.path
        if ($installed.Major -lt $release.version.Major) { throw ($Browser.name + ' 升级后仍为 ' + $installed + '，请关闭浏览器或重启当前运行环境，完成官方升级后重新检测。') }
        $updated = $true
    }
    return @{status='satisfied'; version=$installed.ToString(); stableVersion=$release.version.ToString(); minimumMajor=$release.version.Major; updated=$updated; checkedAt=[DateTime]::UtcNow.ToString('o')}
}
function Get-ManagedBrowserProcesses([string]$ProfilePath) {
    $expected = [IO.Path]::GetFullPath($ProfilePath).TrimEnd('\')
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'")) {
        if (!$process.CommandLine -or $process.CommandLine -notmatch '(?i)(?:^|\s)--user-data-dir(?:=|\s+)(?:"(?<quoted>[^\"]+)"|(?<plain>[^\s\"]+))(?=\s|$)') { continue }
        $path = if ($Matches.quoted) { $Matches.quoted } else { $Matches.plain }
        try { $actual = [IO.Path]::GetFullPath($path).TrimEnd('\') } catch { continue }
        if ($actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { $process }
    }
}
function Close-ManagedBrowser([string]$ProfilePath, [string]$Root, [int]$CloseTimeoutSeconds = 3, [int]$ReleaseTimeoutSeconds = 15) {
    # Initialization owns this dedicated Profile. Let Chromium flush it before forcing any background owner to exit.
    $running = @(Get-ManagedBrowserProcesses $ProfilePath)
    foreach ($candidate in $running) {
        $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
        if ($process) { try { $process.CloseMainWindow() | Out-Null } catch {} }
    }
    if ($running.Count) {
        $deadline = [DateTime]::UtcNow.AddSeconds($CloseTimeoutSeconds)
        while (@(Get-ManagedBrowserProcesses $ProfilePath).Count -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
        foreach ($candidate in @(Get-ManagedBrowserProcesses $ProfilePath)) {
            try { Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop }
            catch { if (Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue) { throw '专用浏览器未能自动关闭，请关闭它后点击重试。' } }
        }
    }
    # The previous launcher may still be disposing its proxy after the browser window has closed.
    $lockPath = Join-Path $Root 'browser.lock'
    $deadline = [DateTime]::UtcNow.AddSeconds($ReleaseTimeoutSeconds)
    do {
        $available = @(Get-ManagedBrowserProcesses $ProfilePath).Count -eq 0
        if ($available -and (Test-Path -LiteralPath $lockPath)) {
            try { $handle = [IO.File]::Open($lockPath, 'Open', 'ReadWrite', 'None'); $handle.Dispose() }
            catch { $available = $false }
        }
        if ($available) { return }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    throw '专用浏览器占用尚未释放，请点击重试以继续初始化。'
}
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
$target = $request.timezoneTarget
if (!$target.windowsId -or !$target.ianaId) { throw '所选代理出口的目标时区未知，请返回第二步重新测试节点。' }
[TimeZoneInfo]::ClearCachedData()
if ((Get-TimeZone).Id -ne $target.windowsId) { throw ('运行环境时区与所选出口不一致，目标为 ' + $target.windowsId + '。请返回运行环境同步时区后重新检测。') }
$profile = Join-Path $root ($selected.id + '\User Data')
# Returning to the wizard must not invalidate an already usable environment.
# Read the saved baseline before closing the browser or writing pending state.
$runtimeId = if ($request.runtimeId) { [string]$request.runtimeId } else { 'native' }
$savedBaseline = $null
if ($prior.baselinePath -and (Test-Path -LiteralPath $prior.baselinePath -PathType Leaf)) {
    try { $savedBaseline = Get-Content -LiteralPath $prior.baselinePath -Raw | ConvertFrom-Json } catch {}
}
$canReuse = $prior -and $prior.runtimeId -eq $runtimeId -and
    $prior.browserId -eq $selected.id -and $prior.profilePath -eq $profile -and
    $prior.executable -eq $selected.path -and $prior.version -eq $selected.version -and
    $prior.nodeId -eq $request.nodeId -and $prior.expectedExitIp -eq $request.exitIp -and
    $prior.targetTimezone -eq $target.ianaId -and $prior.targetWindowsTimezone -eq $target.windowsId -and
    $prior.language -eq (Get-Culture).Name -and
    $prior.compatibility.status -eq 'satisfied' -and !$prior.verificationError -and
    $prior.proxyStatus -eq 'satisfied' -and $prior.parametersStatus -eq 'satisfied' -and
    $prior.shortcutStatus -eq 'satisfied' -and $prior.timezoneStatus -eq 'satisfied' -and
    $prior.verificationStatus -eq 'satisfied' -and $prior.baselineStatus -eq 'satisfied' -and
    $prior.verification.ok -and $prior.verification.exitIp -eq $request.exitIp -and
    $prior.verification.observed.timezone -eq $target.ianaId -and
    $savedBaseline.profileId -eq $prior.profileId -and $savedBaseline.nodeId -eq $request.nodeId -and
    $savedBaseline.browserVersion -eq $selected.version -and $savedBaseline.verification.ok -and
    (Test-Path -LiteralPath $profile -PathType Container) -and
    (Test-Path -LiteralPath $prior.shortcutPath -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $root 'launcher.ps1') -PathType Leaf)
if ($request.action -eq 'prepare' -and $canReuse) {
    @{profile=$prior; available=@($available); reused=$true} | ConvertTo-Json -Depth 18 -Compress
    return
}
if ($request.action -notin @('open', 'inspect', 'install_code', 'install_desktop')) { Close-ManagedBrowser $profile $root }
$compatibility = Ensure-BrowserVersion $selected $root
$selected.version = $compatibility.version
# 每种浏览器使用独立的数据目录，不能用 Chrome 打开 Edge 配置文件。
$reused = Test-Path -LiteralPath $profile -PathType Container
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$runtime = if ($request.runtime) { [string]$request.runtime } else { 'Native' }
$runtimeId = if ($request.runtimeId) { [string]$request.runtimeId } else { 'native' }
$manifest = [ordered]@{ schema = 1; profileId = ($runtimeId + '-' + $selected.id); profileName = 'Claude (CodeSeam)'; profilePath = $profile; browserId = $selected.id; browserName = $selected.name; executable = $selected.path; version = $selected.version; runtime = $runtime; runtimeId = $runtimeId; nodeId = $request.nodeId; nodeName = $request.nodeName; expectedExitIp = $request.exitIp; createdAt = $(if ($prior -and $prior.browserId -eq $selected.id) { $prior.createdAt } else { [DateTime]::UtcNow.ToString('o') }); language = (Get-Culture).Name; timezone = (Get-TimeZone).Id; proxyStatus = 'pending'; parametersStatus = 'pending'; shortcutStatus = 'pending'; verificationStatus = 'pending'; baselineStatus = 'pending'; mihomo=$request.mihomo }
$manifest.compatibility = $compatibility
$manifest.targetTimezone = [string]$target.ianaId
$manifest.targetWindowsTimezone = [string]$target.windowsId
$manifest.timezoneStatus = 'pending'
function Save-Profile {
    $temp = $manifestPath + '.tmp'
    $manifest | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $manifestPath -Force
}
function Start-BrowserTask([string]$Mode, [string]$OutputPath) {
    $taskName = 'CodeSeam-Browser-' + [guid]::NewGuid().ToString('N')
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $root 'launcher.ps1') + '" -Mode ' + $Mode
    if ($OutputPath) { $arguments += ' -ResultPath "' + $OutputPath + '"' }
    if ($runtime -eq 'Native') {
        # Explorer owns this process, outside the short-lived detection job; no administrator task registration.
        $shellApplication = New-Object -ComObject Shell.Application
        $location = 0
        $locationRoot = 0
        $desktopHandle = 0
        $desktopWindow = $shellApplication.Windows().FindWindowSW([ref]$location, [ref]$locationRoot, 8, [ref]$desktopHandle, 1)
        if (!$desktopWindow -or !$desktopWindow.Document.Application) { throw '未找到当前用户的 Windows 桌面，请登录桌面后重试。' }
        $desktopWindow.Document.Application.ShellExecute((Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'), $arguments, $root, 'open', 0)
        $deadline = [DateTime]::UtcNow.AddSeconds($(if ($Mode -eq 'verify') {170} else {15}))
        do {
            if (Test-Path -LiteralPath $OutputPath) { return (Get-Content -LiteralPath $OutputPath -Raw | ConvertFrom-Json) }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $deadline)
        throw '浏览器启动超时，请确认当前 Windows 桌面可用后重试。'
    }
    $user = if ($request.desktopUser) { [string]$request.desktopUser } else { [Security.Principal.WindowsIdentity]::GetCurrent().Name }
    $action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument $arguments
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit $(if ($Mode -eq 'verify') {[TimeSpan]::FromMinutes(3)} else {[TimeSpan]::Zero}) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    try {
        Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
        $deadline = [DateTime]::UtcNow.AddSeconds($(if ($Mode -eq 'verify') {170} else {15}))
        do {
            if (Test-Path -LiteralPath $OutputPath) { return (Get-Content -LiteralPath $OutputPath -Raw | ConvertFrom-Json) }
            $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
            $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
            if ($task.State -ne 'Running' -and $info.LastRunTime.Year -gt 2000 -and $info.LastTaskResult -ne 0 -and $info.LastTaskResult -ne 267009) { throw ('浏览器任务启动失败：' + $info.LastTaskResult) }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $deadline)
        throw '浏览器任务超时，请确认当前 Runtime 的 CodeSeam 桌面已登录后重试。'
    } finally {
        if ($Mode -eq 'verify') { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    }
}
if ($request.action -in @('open', 'inspect', 'install_code', 'install_desktop')) {
    if (!$prior -or $prior.verificationStatus -ne 'satisfied' -or $prior.nodeId -ne $request.nodeId -or $prior.browserId -ne $selected.id) { throw '请先完成当前节点的专用浏览器验证。' }
    if (!$prior.compatibility -or $prior.version -ne $selected.version -or $prior.compatibility.minimumMajor -ne $compatibility.minimumMajor) { throw '浏览器版本已变化，请重新检测并验证后再打开。' }
    if ($prior.timezoneStatus -ne 'satisfied' -or $prior.targetTimezone -ne $target.ianaId -or $prior.verification.observed.timezone -ne $target.ianaId -or $prior.expectedExitIp -ne $request.exitIp) { throw '出口或目标时区已变化，请关闭专用浏览器后重新检测并验证。' }
    if ($request.worker) { [IO.File]::WriteAllText((Join-Path $root 'launcher.ps1'), [string]$request.worker, [Text.UTF8Encoding]::new($true)) }
    $outputPath = Join-Path $root ('open-' + [guid]::NewGuid().ToString('N') + '.json')
    try { $opened = Start-BrowserTask $request.action $outputPath }
    finally { Remove-Item -LiteralPath $outputPath -ErrorAction SilentlyContinue }
    if (!$opened.ok) { throw $opened.error }
    @{opened=$true;browserProcessId=$opened.browserProcessId} | ConvertTo-Json -Compress
    return
}
Save-Profile
if ($request.worker) {
    try {
        [IO.File]::WriteAllText((Join-Path $root 'launcher.ps1'), [string]$request.worker, [Text.UTF8Encoding]::new($true))
        if ($runtime -eq 'Native') {
            Add-Type -AssemblyName System.Security
            $bytes = [Text.Encoding]::UTF8.GetBytes(($request.nodeConfig | ConvertTo-Json -Depth 30 -Compress))
            [IO.File]::WriteAllBytes((Join-Path $root 'node.dpapi'), [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))
        }
        $desktop = if ($request.desktopPath) { [string]$request.desktopPath } else { [Environment]::GetFolderPath('DesktopDirectory') }
        New-Item -ItemType Directory -Path $desktop -Force | Out-Null
        $shortcutPath = Join-Path $desktop 'Claude (CodeSeam).lnk'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $root 'launcher.ps1') + '" -Mode open'
        $shortcut.WorkingDirectory = $root
        $shortcut.IconLocation = $selected.path + ',0'
        $shortcut.Description = 'Claude 专用 Profile 与所选受管出口'
        $shortcut.Save()
        $manifest.shortcutStatus = 'satisfied'
        $manifest.shortcutPath = $shortcutPath
        Save-Profile
        $outputPath = Join-Path $root ('verify-' + [guid]::NewGuid().ToString('N') + '.json')
        try { $verification = Start-BrowserTask 'verify' $outputPath }
        finally { Remove-Item -LiteralPath $outputPath -ErrorAction SilentlyContinue }
        if (!$verification.ok) { throw $verification.error }
        if ($verification.observed.timezone -ne $manifest.targetTimezone) { throw ('浏览器实际时区 ' + $verification.observed.timezone + ' 与所选出口时区 ' + $manifest.targetTimezone + ' 不一致，请关闭专用浏览器后重新检测。') }
        $manifest.timezoneStatus = 'satisfied'
        $manifest.proxyStatus = 'satisfied'
        $manifest.parametersStatus = 'satisfied'
        $manifest.verificationStatus = 'satisfied'
        $manifest.verification = $verification
        $manifest.baselineStatus = 'satisfied'
        $baseline = @{schema=1; profileId=$manifest.profileId; runtimeId=$runtimeId; nodeId=$request.nodeId; browserVersion=$selected.version; compatibility=$compatibility; targetTimezone=$manifest.targetTimezone; timezoneStatus=$manifest.timezoneStatus; verification=$verification; confirmed=($request.action -eq 'confirm')}
        if ($baseline.confirmed) { $baseline.confirmedAt = [DateTime]::UtcNow.ToString('o') }
        $baselinePath = Join-Path $root 'browser-baseline.json'
        $baseline | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath ($baselinePath + '.tmp') -Encoding UTF8
        Move-Item -LiteralPath ($baselinePath + '.tmp') -Destination $baselinePath -Force
        $manifest.baselinePath = $baselinePath
        $manifest.confirmed = $baseline.confirmed
    } catch {
        $manifest.baselineStatus = 'pending'
        $manifest.confirmed = $false
        $manifest.verificationError = $_.Exception.Message
        if ($request.action -eq 'confirm') { Save-Profile; throw }
    }
}
Save-Profile
@{ profile = $manifest; available = @($available); reused = [bool]$reused } | ConvertTo-Json -Depth 18 -Compress
