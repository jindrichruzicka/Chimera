---
'@chimera-engine/renderer': minor
---

Give `AnimatedSprite` an appearance surface and a custom-material seam.

`AnimatedSpriteProps` now takes `color`, `opacity`, `blending`, `alphaMode`, `alphaThreshold`,
`depthWrite` and `depthTest`, so tinting, additive sprites and cutout sprites no longer require
replacing the material. `blending` and `alphaMode` are engine-owned names — `'additive'`, `'mask'` —
so a game never imports `three` for a prop value. An alpha mode decides exactly two material fields:
`transparent`, and the `alphaTest` used when no `alphaThreshold` is authored. Declaring no
`alphaMode` keeps the pre-existing default, which is a hybrid none of the three modes spells and is
unchanged here deliberately.

A new `material` prop is the supported seam for a custom sprite material, and it **receives the
sheet texture** the component has already resolved, so a game no longer resolves the same sheet a
second time to reach an object the component is holding. The element is cloned rather than written
into, and nothing else about it is touched — none of the appearance props is applied to a supplied
material. A material whose `map` prop is set keeps it, `map={null}` included; an element handing
over a material instance — a `<primitive>` — receives nothing, because r3f would apply the prop by
writing onto an instance the game owns. A
material supplied as `children` still works and still does not receive the texture.

Tinting one sprite does not tint others cut from the same sheet: the tint is on the material
instance, never on the manager-owned texture.
