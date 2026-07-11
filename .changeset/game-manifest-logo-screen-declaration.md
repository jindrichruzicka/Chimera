---
'@chimera-engine/simulation': minor
---

Add the optional logo-screen declaration to the `GameManifest` contract (F70). New exports from `foundation/game-manifest-contract`: `GameLogoScreen` (an opaque game-owned `route` of the form `` `/${string}` ``), the optional `GameManifest.logoScreen` field, and the pure `resolveGameLogoScreen(manifest)` helper. The resolver returns `undefined` for an absent declaration or a malformed route (non-string, missing the leading slash, or carrying a `?` query / `#` fragment) and never throws — a bad manifest can never brick a packaged boot; the host just falls back to the main menu. Behaviour-neutral for games that declare nothing: boot goes straight to `/main-menu` exactly as before.
