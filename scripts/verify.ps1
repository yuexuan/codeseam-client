$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  & "$PSScriptRoot/prepare-mihomo.ps1"
  npm run check
  if ($LASTEXITCODE -ne 0) { throw 'Frontend checks failed' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'Rule tests failed' }
  cargo test --manifest-path src-tauri/Cargo.toml --locked
  if ($LASTEXITCODE -ne 0) { throw 'Native checks failed' }
  npm run bindings:check
  if ($LASTEXITCODE -ne 0) { throw 'Generated bindings drift' }
} finally { Pop-Location }
