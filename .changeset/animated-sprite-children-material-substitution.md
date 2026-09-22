---
'@chimera-engine/renderer': minor
---

Stop a non-material child deleting `AnimatedSprite`'s material.

`AnimatedSprite` used `children ?? <default/>`, so **any** child suppressed the default material —
`false` included. `<AnimatedSprite>{flag && <Mat/>}</AnimatedSprite>` with the flag off rendered a
mesh carrying `three`'s implicit white `MeshBasicMaterial` and no map, and so did a non-material
child such as a nested `<group>`, an `<Html>` label or text.

The default is now emitted whenever `children` carries no material, and `children` is always
rendered rather than standing in for the material. **This changes rendered output for existing
callers**: a sprite that passed a non-material child previously drew an unmapped white quad and now
draws its sheet, and a material-carrying child still replaces the default exactly as before.

Which children count as a material is decided by `attach` first — in both directions, so
`<meshDepthMaterial attach="customDepthMaterial"/>` is not read as the mesh's material — then by an
`object` holding a material instance, then by a fragment's contents, then by an intrinsic's name,
with a component read as the material.
