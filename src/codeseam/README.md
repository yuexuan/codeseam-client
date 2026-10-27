# CodeSeam Windows MVP

`App.tsx` is the customer entry selected by `src/main.tsx`. It invokes the native CodeSeam commands and never receives service Keys or refresh tokens. The existing upstream UI remains in place for upstream maintenance, but is not loaded by this entry.

The five desktop pages reuse the native login, service activation, loopback proxy, CLI configuration/launch and network diagnostics. Usage comes from the existing authenticated service API. Official 5h/1w and per-session usage are not inferred from platform totals. Non-API network protection remains unverified.

## Brand identity

`assets/codeseam-logo.svg` is the canonical transparent CodeSeam mark. Both themes use it; `src-tauri/icons/codeseam.ico` is rendered from that SVG at 16–256px for the app and installer. The Portal carries the identical SVG. Light and dark themes share the champagne-gold accent and compact desktop navigation, scrolling content area and fixed launch footer.

## Build and delivery

After `npm ci`, run `pwsh -File scripts/build-windows.ps1` with Rust/MSVC installed on the build machine. The NSIS installer and SHA256/signature manifest are written to `release/`. The installed client embeds its frontend and needs neither Vite, Cargo nor Node. WebView2 is required; the installer embeds Microsoft's bootstrapper (network required when WebView2 is absent). Claude Code is installed independently; a native `claude.exe` on PATH avoids Node even for CLI startup.

Configure the actual service origin and Portal URL on the login/settings pages. Remote services require HTTPS; defaults are explicitly the local QA service, not a fabricated production domain. Logout stops the managed terminal and proxy, restores managed Claude fields and removes the encrypted session. Normal close retains the encrypted session/backup for restart. Uninstall restores managed fields first; conflicts preserve the backup and abort removal.

`verify-installed.mjs` is a developer QA harness, requiring an explicitly enabled WebView2 debugging port in that test process. No test server or debug port is enabled by ordinary product startup. The single P5 task and evidence are in the server Fork's `codeseam/delivery/`; the client `docs/p5/` and workspace `../docs/tasks/` contain indexes.
