---
'@chimera-engine/renderer': patch
---

Route `display.shadowQuality` to `LightingRig`'s shadow map.

`LightingRig` now reads the shadow quality its `GameCanvas` resolves — the player's tier, capped by
the game's `shadows` ceiling — and sizes its key light's shadow map from it: 512 px per side at
`basic`, 1024 at `percentage`, 2048 at `soft` and `variance`. At `off` the key light does not cast,
whatever `castShadow` says.

A quality change applies live, without remounting the canvas: the rig releases the shadow map three
built at the old size, so the next frame allocates one at the new size.

`LightingRig` must be mounted inside a `GameCanvas`; outside one it throws.
