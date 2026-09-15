---
'@chimera-engine/renderer': patch
'@chimera-engine/tactics': patch
'@chimera-engine/action': patch
---

Adopt `LightingRig` in both reference apps, so the shadows their meshes already ask for render.

The tactics board, the action playfield and the action shell background now mount `LightingRig`
instead of a hand-rolled ambient + directional pair, keeping each scene's intensities and key light
position. Tactics' old key light did not cast, so its units' `castShadow` and its ground's
`receiveShadow` rendered nothing even with shadow mapping on; the rig's key light casts.

Both apps default `display.shadowQuality` to `medium` over the engine's `off`, so a fresh install
shows the shadows, and a player can still turn them off.

`LightingRig` gains `shadowCameraExtent`, the half-side of the box its key light's shadow covers.
Omitted, it keeps three's own `5`; the action arena is wider than that, so both action scenes size
the box from the arena.
