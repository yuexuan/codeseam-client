# CodeSeam P1 desktop UI

`App.tsx` is the customer entry selected by `src/main.tsx`. It invokes the native CodeSeam commands and never receives service Keys or refresh tokens. The existing upstream UI remains in place for upstream maintenance, but is not loaded by this entry.

Scope: login, owned service authorization, loopback proxy state, CLI detection, confirmed settings backup/configuration, managed terminal start/stop and restoration. Authorization status is separate from actual Gateway/upstream health. P2–P5 are not implemented here.
