$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root 'src-tauri/resources/mihomo.exe'
if (!(Test-Path -LiteralPath $target)) { throw 'Run scripts/prepare-mihomo.ps1 before this regression test' }
$expected = '5A0231811A80B27477EBDEE15684B41946D01AFBD2114534E9A4B256125CA147'
# 在子进程启动后设置不兼容路径，避免启动时自动补全默认模块路径掩盖故障。
$pwshDirectory = Split-Path (Get-Command pwsh.exe -ErrorAction Stop).Source -Parent
$modulePath = (Join-Path $pwshDirectory 'Modules').Replace("'", "''")
$scriptPath = (Join-Path $root 'scripts/prepare-mihomo.ps1').Replace("'", "''")
$command = "`$ErrorActionPreference = 'Stop'; `$ProgressPreference = 'SilentlyContinue'; `$env:PSModulePath = '$modulePath'; & '$scriptPath'"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
& powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded
if ($LASTEXITCODE -ne 0) { throw 'Mihomo build hook failed with an inherited module path' }
if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $expected) { throw 'Mihomo resource checksum mismatch' }
'PASS: Windows PowerShell build hook resolves system modules with an incompatible inherited module path'
