$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# 所有计数共用一次只读快照。发现配置不代表保护已验证。
$all = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe' OR Name='msedge.exe' OR Name='chrome.exe'")
$desktopPattern = '\\AnthropicClaude\\|\\claude\\app-|\\WindowsApps\\Anthropic'
$claude = @($all | Where-Object { $_.Name -ieq 'claude.exe' -and $_.ExecutablePath })
$desktop = @($claude | Where-Object { $_.ExecutablePath -match $desktopPattern -and $_.CommandLine -notmatch '--type=' })
$code = @($claude | Where-Object { $_.ExecutablePath -notmatch $desktopPattern -and $_.ExecutablePath -match '\\\.local\\|\\claude-code\\|\\npm\\' })
$codeIds = @($code | ForEach-Object { $_.ProcessId })
$code = @($code | Where-Object { $codeIds -notcontains $_.ParentProcessId })
$web = @($all | Where-Object { $_.Name -ine 'claude.exe' -and $_.CommandLine -and $_.CommandLine.Contains('CodeSeam\Browser\native\') -and $_.CommandLine.Contains('--user-data-dir') -and $_.CommandLine -notmatch '--type=' })
$codeInstalled = [bool](Get-Command claude.exe -ErrorAction SilentlyContinue)
$desktopInstalled = [bool](Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'AnthropicClaude'))
@{code=@{count=$code.Count;installed=($codeInstalled -or $code.Count -gt 0)};desktop=@{count=$desktop.Count;installed=($desktopInstalled -or $desktop.Count -gt 0)};web=@{count=$web.Count;installed=$true}} | ConvertTo-Json -Compress -Depth 5
