$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  & "$PSScriptRoot/prepare-mihomo.ps1"
  npm run check
  if ($LASTEXITCODE -ne 0) { throw 'Frontend checks failed' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'Rule tests failed' }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/browser-lifecycle.test.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Browser lifecycle tests failed' }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/browser-close.test.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Managed browser close tests failed' }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/browser-version.test.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Browser version tests failed' }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/browser-launch.test.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Browser launch tests failed' }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/guest-session.test.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Guest session tests failed' }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/guest-timezone.test.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Guest timezone tests failed' }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/guest-console.test.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Guest console tests failed' }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/guest-controller.test.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Guest controller tests failed' }
  cargo test --manifest-path src-tauri/Cargo.toml --locked
  if ($LASTEXITCODE -ne 0) { throw 'Native checks failed' }
  npm run bindings:check
  if ($LASTEXITCODE -ne 0) { throw 'Generated bindings drift' }
} finally { Pop-Location }
