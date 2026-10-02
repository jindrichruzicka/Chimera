---
'@chimera-engine/renderer': patch
---

Release `LightingRig`'s key-light shadow map when the resolved shadow quality changes to `off`.

On a change to `off`, the rig disposes the shadow map three built for its key light, and any blur
pass, and clears both. The map's size is kept, so a return to the same quality allocates a fresh map
at that size.
