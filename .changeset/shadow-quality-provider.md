---
'@chimera-engine/renderer': patch
---

Export `ShadowQualityProvider` from `@chimera-engine/renderer/components/r3f`, so a game's component
test can mount `LightingRig` without a `GameCanvas`.

`LightingRig` sizes its key light's shadow map from the shadow quality its `GameCanvas` resolved. A
test that mounts a scene under `@react-three/test-renderer` has no `GameCanvas` to resolve one, so it now
wraps the scene in `<ShadowQualityProvider quality="…">` and the rig reads that quality instead.

The provider throws when mounted inside a `GameCanvas` or inside another `ShadowQualityProvider`, so
a rig under a `GameCanvas` still reads only the canvas's resolution.
