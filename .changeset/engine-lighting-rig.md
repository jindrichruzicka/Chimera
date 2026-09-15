---
'@chimera-engine/renderer': patch
---

Add `LightingRig`, an engine-owned default light rig, to `@chimera-engine/renderer/components/r3f`.

Mounted as a child of `GameCanvas`, it renders one ambient light and one directional key light, so a
game gets usable lighting without hand-rolling `<ambientLight>` + `<directionalLight>`. Its props are
plain numbers, a position tuple and a flag — `ambientIntensity`, `keyLightIntensity`,
`keyLightPosition` and `castShadow` — so configuring it imports neither `three` nor `Canvas`.

The rig is a default, not a monopoly: it suppresses nothing, so a game's own lights mount beside it,
and a game that wants bespoke lighting keeps writing its lights as before.
