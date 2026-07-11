---
'create-chimera-game': minor
---

Mirror the F70 logo-screen adoption in the blank template so every scaffolded game boots Chimera-branded out of the box: the manifest declares an active `logoScreen: { route: '/logo-screen' }`, `renderer/app/logo-screen/page.tsx` re-exports the engine default logo page, and the engine brand video ships as a committed `renderer/public/chimera_logo.mp4` copy. Packaged boots land on the logo screen; dev boots are untouched. Remove the manifest field to opt out, point the route at your own page for a custom intro sequence, or replace the mp4 with your own brand cut — that media is then game-owned (Invariant #97).
