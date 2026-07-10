---
'@chimera-engine/simulation': minor
---

Add the optional hardware-cursor declaration to the `GameManifest` contract (F69). New exports from `foundation/game-manifest-contract`: `GameCursorRole` (`'default' | 'pointer' | 'disabled'`), `GameCursorHotspot`, `GameCursorImage` (game-asset-relative `image` path + optional `hotspot`), `DEFAULT_CURSOR_HOTSPOT`, the optional `GameManifest.cursor` field, and the pure `resolveGameCursor(manifest)` helper that normalizes declared roles (hotspots defaulted to `(0, 0)`) and returns `undefined` for absent or empty declarations — behaviour-neutral: the plain system cursor stays. Image paths are opaque at this layer and resolved only by the renderer through the game-asset protocol.
