[CmdletBinding()]
param([switch]$Build,[int]$DebugPort=0,[string]$ConfigDir='')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $repo
try {
    if ($Build) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {throw 'UI build failed'}
        & cargo.exe build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
        if ($LASTEXITCODE -ne 0) {throw 'Native build failed'}
    }
    $cli=Join-Path $repo '.local/cli/node_modules/.bin'
    if (Test-Path -LiteralPath $cli) {$env:PATH="$cli;$env:PATH"}
    if ($ConfigDir) {$env:CLAUDE_CONFIG_DIR=[IO.Path]::GetFullPath($ConfigDir)}
    if ($DebugPort -gt 0) {$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$DebugPort"}
    else {Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue}
    # This is the interactive desktop application explicitly requested by the user.
    $p=Start-Process -FilePath (Join-Path $repo 'src-tauri/target/debug/z-switch.exe') -WorkingDirectory $repo -PassThru
    Write-Host "CodeSeam client PID $($p.Id)"
} finally {Pop-Location}
