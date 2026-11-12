$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root 'src-tauri/resources/mihomo.exe'
if ((Test-Path $target) -and (Get-FileHash $target -Algorithm SHA256).Hash -eq '5A0231811A80B27477EBDEE15684B41946D01AFBD2114534E9A4B256125CA147') { return }
$cache = Join-Path $root '.local/mihomo-download'
New-Item -ItemType Directory -Force $cache | Out-Null
$zip = Join-Path $cache 'core.zip'
Invoke-WebRequest 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.34/mihomo-windows-amd64-compatible-v1.19.34.zip' -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne 'CD6738D4648CC1A5F48049A1343B697AB510889D648F045C5C780FC1AB443A79') { throw 'Mihomo checksum mismatch' }
Expand-Archive $zip $cache -Force
New-Item -ItemType Directory -Force (Split-Path $target -Parent) | Out-Null
Copy-Item (Join-Path $cache 'mihomo-windows-amd64-compatible.exe') $target
