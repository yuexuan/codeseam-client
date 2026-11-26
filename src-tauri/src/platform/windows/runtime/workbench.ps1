param([string]$ProfilePath = '')
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
$profilePattern = if ($ProfilePath) { '(?i)--user-data-dir(?:=|\s+)"?' + [regex]::Escape($ProfilePath) + '(?:"|\s|$)' } else { '(?i)--user-data-dir(?:=|\s+)"?[^"\r\n]*CodeSeam\\Browser\\native\\' }
$web = @($all | Where-Object { $_.Name -ine 'claude.exe' -and $_.CommandLine -match $profilePattern -and $_.CommandLine -notmatch '--type=' })
$desktopHome = if ($ProfilePath -match '^(?<home>.+)\\AppData\\Local\\') { $Matches.home } else { $env:USERPROFILE }
$codeInstalled = [bool](Test-Path -LiteralPath (Join-Path $desktopHome '.local\bin\claude.exe')) -or [bool](Test-Path -LiteralPath (Join-Path $desktopHome 'AppData\Roaming\npm\claude.cmd'))
if (!$ProfilePath) { $codeInstalled = $codeInstalled -or [bool](Get-Command claude.exe -ErrorAction SilentlyContinue) }
$desktopInstalled = [bool](Test-Path -LiteralPath (Join-Path $desktopHome 'AppData\Local\AnthropicClaude'))
@{code=@{count=$code.Count;installed=($codeInstalled -or $code.Count -gt 0)};desktop=@{count=$desktop.Count;installed=($desktopInstalled -or $desktop.Count -gt 0)};web=@{count=$web.Count;installed=$true}} | ConvertTo-Json -Compress -Depth 5
