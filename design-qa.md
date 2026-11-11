# Environment diagnostics redesign QA — 2026-11-04

final result: passed

This result covers the redesigned desktop UI, not certification of all network protections. The existing CodeSeam desktop shell is preserved. System-wide DNS leak verification and Firefox real-machine validation remain limitations below.

## Reference and captures

The approved system and browser references are saved alongside the captures in `../docs/tasks/evidence/2026-11-04-diagnostics-redesign/`. Reference images are 1495 × 1052 pixels; implementation captures use a 1440 × 1013 CSS viewport at device scale 1. Reference normalization preserves aspect ratio. Full paired comparisons are `system-comparison.png` and `browser-comparison.png`; the corresponding `*-detail-comparison.png` files expose typography and row alignment. Both sides were opened together for review. The native application default 1080 × 760 viewport was also checked; neither page had horizontal overflow.

The screenshots and browser interactions use the explicit development-only `?qa=diagnostics` fixture and carry a visible example-data label. They are not real network results. Production builds omit this fixture. Separate native Rust integration tests exercised actual installed browsers and the real local proxy.

## Findings and fixes

- P2, resolved: expanded results initially consumed too much vertical space. DNS/IPv6 now use compact observed-value fields, fingerprint evidence shares one horizontal band, region information lives inside network-exit details, and browser configuration uses inline fields. Before/after paired captures are preserved.
- P2, resolved: the browser chooser initially stayed open throughout the automatic scan. It now closes after a successful launch so individual waiting/running/final statuses are visible.
- P2, resolved: Ctrl+Home originally activated the first diagnostics tab. Modified keys now retain their normal scrolling behavior; plain Home/End and arrow keys still navigate the tabs.
- P2, resolved: status text and primary buttons needed stronger contrast. Light-theme success/warning text and solid primary colors now have darker foreground/background values; labels and icons convey state independently of color.
- No remaining P0/P1/P2 visual issues were identified in the reviewed surfaces.

## Required fidelity surfaces

- Typography: native Segoe UI / Microsoft YaHei family; 25px page title, 17px section headings, 14px result content, compact supporting text. The implementation intentionally follows readable native application sizing rather than copying the raster reference's oversized shell typography.
- Spacing: flat page sections, thin separators, aligned item/result/state columns, compact settings, natural vertical scrolling at smaller window sizes. No nested large cards or permanently visible warning panels.
- Colors: existing warm-white/amber brand tokens remain; green means pass, amber means configuration or reboot needed, red means failure. Expanded evidence is a quiet neutral surface.
- Images: the original CodeSeam SVG logo is reused without scaling distortion. Browser choices use text labels; custom browser logos were not fabricated. This is an accepted P3 visual difference from the generated reference.
- Copy: results are concise; explanatory caveats are in help/details. No successful result is relabeled as observed/read-only. Missing/failed evidence is never promoted to pass. New environments remain visibly uncreated, saved environments retain historical results and their timestamps.

## Verification

- TypeScript and Vite production build: passed.
- Rust diagnostics suite: 19 passed, 6 explicitly opt-in tests ignored in the default run.
- Actual Chrome profile close/reopen: passed, including a persisted test cookie and identical saved fingerprint; changing resolution produced a mismatch without replacing the baseline.
- Actual Edge profile close/reopen: passed with the same cookie, baseline retention and drift checks.
- Actual browser DNS guard: passed using a real numeric-address local HTTP proxy and a domain request with local resolution blocked. A dead-proxy counterpart did not pass and did not fall back to a direct request.
- In-app browser fixture interactions: sequential progress, green pass results, expanded facts, configuration confirmation, affected-item recheck, installed-browser chooser, uncreated state, close/retained history, destroy confirmation and record clearing passed. Browser error log was empty on the final check.
- Current machine's system DNS/IPv6 settings were not changed during verification. Existing rollback/drift-guard tests passed using isolated fixtures.

## Remaining capability boundaries

- Windows system-wide DNS currently has resolver observations and configuration options, but lacks an authoritative correlated path/capture probe. It remains configuration-needed and is not represented as globally leak-free. Browser-level DNS protection is scoped to the managed Chromium environment.
- Firefox's BiDi adapter and installed-browser selection are implemented. Firefox is not installed on this machine, so real Firefox integration is unverified; Firefox 144+ is needed for the native timezone command. Its DNS result remains conservative when evidence is insufficient.
- The reference's environment-variable row remains represented by the existing Claude configuration checks rather than an invented system-wide pass result.

## Protocol sources

[Chromium proxy/DNS rules](https://new.chromium.org/developers/design-documents/network-stack/socks-proxy/) and [Mozilla BiDi connection documentation](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection) informed the adapters. The Firefox timezone command is defined in the [WebDriver BiDi specification](https://www.w3.org/TR/2026/WD-webdriver-bidi-20260309/#command-emulation-setTimezoneOverride).

## Implementation checklist

- [x] Preserve the native product shell and approved result/configuration hierarchy.
- [x] Execute each scan item against a real backend request in display order.
- [x] Confirm privileged changes in a modal and automatically recheck affected items.
- [x] Inherit the configured network proxy and keep browser profiles isolated by browser.
- [x] Seed resolution from the monitor, persist observed identity, and expose destruction/recreation.
- [x] Preserve explicit distinctions between visual fixtures, native tests and unverified capabilities.
