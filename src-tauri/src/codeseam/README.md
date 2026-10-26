# CodeSeam P1 native entry

`mod.rs` registers only CodeSeam commands. The retained upstream entry is not executed: no provider import/export, CLI rewrite on first launch, upstream tray actions, deep links or updater initialization.

- Auth uses native Sub2API login/refresh/logout. Session tokens and selected service ID use CurrentUser DPAPI (`%LOCALAPPDATA%/CodeSeam/session.dpapi`). Passwords are not persisted. Service Keys are fetched after authorization and held only in the existing proxy's in-memory target.
- `cli.rs` detects Claude on PATH, backs up settings using DPAPI, changes only three API environment fields, refuses field drift, restores original values while preserving unrelated edits, and starts/stops its own Claude terminal. `CLAUDE_CONFIG_DIR` is respected.
- `vault.rs` uses Windows DPAPI without a plaintext or machine-scope fallback.
- The upstream Axum proxy is reused on `127.0.0.1:18899/claude`; the managed flag disables redirects/environment proxies and allows only messages/count_tokens/models. No direct API fallback is provided. This does not implement P3 process/network protection.

Build: `npm run build`, then `cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol` from the client root. Start with `src/codeseam/start-dev.ps1`. A workspace-only CLI installation can use `npm install --prefix .local/cli @anthropic-ai/claude-code`.

P1 QA uses a dedicated `-ConfigDir .../.local/claude-profile`; it does not overwrite the user's default Claude profile. `-DebugPort 19222` enables a test-only WebView2 inspection port via process environment; omit it for ordinary runs.
