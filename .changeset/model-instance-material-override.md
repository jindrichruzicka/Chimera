---
'@chimera-engine/renderer': minor
---

Add a per-instance material override to `useModelInstance`.

Every mount of a `gltf-model` ref shared its materials with the cached asset, so there was no
sanctioned way to tint one unit and not its siblings — the selection, damage and team-colour
affordances of a game whose units are loaded models. `useModelInstance` now takes a
second argument, `ModelInstanceMaterialOverride` (exported from the same `assets` barrel), with a
`color` that is multiplied into each material's authored colour and an `emissive` that replaces it;
both accept a CSS colour string or a packed `0xrrggbb` number.

An override makes the clone own a copy of every material under its root — `Material.clone()`
copies the `Color` fields and shares the textures — so the cached material is never written and
Invariant #21's sharing rule is unchanged. `releaseModelInstance` disposes those copies alongside
the clone's skeletons. The clone is keyed on whether an override is present: adding or removing one
re-clones, while changing its values re-colours the owned materials in place and keeps the instance
identity. An emissive on an unlit model (`MeshBasicMaterial` has no emissive field) is applied to
nothing. The cost is a copy of every material under the root per overridden mount; a tint or emissive
alone triggers no shader compile, as three keys its program cache on a material's feature
set rather than its colour values.
