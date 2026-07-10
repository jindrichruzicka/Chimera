---
'create-chimera-game': patch
---

Document the F69 `GameManifest.cursor` declaration in the blank template's manifest: the JSDoc now explains the cursor roles (`default` | `pointer` | `disabled`), the game-asset-relative image convention (Invariant #97), and the hotspot default, alongside a commented-out `cursors/default.png` example. No cursor textures ship with the template — a scaffolded game opts in by uncommenting the example and adding its own PNGs under `assets/cursors/`; until then the plain system cursor stays.
