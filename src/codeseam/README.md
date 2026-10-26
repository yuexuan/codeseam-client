# CodeSeam P1 desktop UI

`App.tsx` is the customer entry selected by `src/main.tsx`. It invokes the native CodeSeam commands and never receives service Keys or refresh tokens. The existing upstream UI remains in place for upstream maintenance, but is not loaded by this entry.

Scope: login, owned service authorization, loopback proxy state, CLI detection, confirmed settings backup/configuration, managed terminal start/stop and restoration. Authorization status is separate from actual Gateway/upstream health. P2–P5 are not implemented here.

## Brand identity

`src/codeseam/assets/codeseam-logo.svg` is the canonical, transparent, scalable CodeSeam mark, redrawn from the approved champagne-gold client design. Import it rather than recreating glyphs in views. Use the same asset for both light and dark UI themes. Native Tauri binary app/installer icons remain upstream placeholders until corresponding raster/ICO/ICNS artifacts are committed together with their config references.
