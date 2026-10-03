---
'@chimera-engine/renderer': patch
---

Document how a custom `ShaderMaterial` on `AnimatedSprite` receives the sheet texture.

The `material` prop hands the texture over as a `map` prop, which a `ShaderMaterial` does not sample.
A material component receives that prop, seats the texture in the uniforms of the `ShaderMaterial` it
builds, and hands the instance over as a `<primitive>`, so a custom shader does not resolve the sheet
a second time. The `material` prop's TSDoc and the animation-system guide now show this shape.
