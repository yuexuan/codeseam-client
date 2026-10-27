[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repo
try {
    & npm.cmd run tauri -- build --bundles nsis
    if($LASTEXITCODE -ne 0){throw 'Windows release build failed'}
    $source=Join-Path $repo 'src-tauri/target/release/bundle/nsis/CodeSeam_0.5.0_x64-setup.exe'
    $dest=Join-Path $repo 'release'
    New-Item -ItemType Directory -Force $dest | Out-Null
    Copy-Item -LiteralPath $source -Destination $dest
    Copy-Item -LiteralPath (Join-Path $repo 'PRODUCT-NOTICE.txt') -Destination $dest
    $file=Join-Path $dest (Split-Path $source -Leaf)
    [ordered]@{version='0.5.0';file=(Split-Path $file -Leaf);sha256=(Get-FileHash -LiteralPath $file).Hash;signature=(Get-AuthenticodeSignature -LiteralPath $file).Status.ToString()} | ConvertTo-Json | Set-Content (Join-Path $dest 'manifest.json')
    Write-Output "Windows installer: $file"
} finally {Pop-Location}
