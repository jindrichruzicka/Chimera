---
'@chimera-engine/renderer': patch
---

Release `LightingRig`'s key-light blur pass when the resolved shadow quality leaves `variance` for `soft`.

Both qualities size the map at 2048, so the change kept the blur pass three built at `variance`, and
three does not free it on the shadow-map type change. The rig now disposes and clears the pass on that
change and leaves the map to three, which rebuilds it for the new type.
