---
'@chimera-engine/action': minor
---

Light the action menu's mirror ball with a manifest-declared HDRI, and prove it renders with nothing
fetched.

The menu background gains a decorative chrome sphere whose only light is the environment map it
reflects. A physically-based metal has no diffuse term, so with no environment map it renders
near-black under any number of lights — which is what makes one frame enough to say an HDRI decoded,
uploaded and lit a PBR material, with no before-and-after comparison to arrange.

The sky ships in `apps/action/assets/`, resolves through the shell manifest like every other asset,
and is GENERATED: `tools/gen-action-environment-hdr.ts` emits it and a byte-equality test holds the
committed file equal to that output, because a Radiance image cannot be reviewed by reading it. The
shell payload now forwards its inventory as `shellBackgroundAssets` as well as `shellAudioAssets`,
which is what opens an asset session around the background subtree so its own components can resolve
a ref.

`environment-map.spec.ts` asserts both halves in the running app: the reflection reaches the screen,
and the requests its recorder saw all used a local scheme. The recorder is installed from the spec
rather than shipped, and carries a positive control — one that was never wired would report no
outbound request just as convincingly as an app that made none. What it cannot see is stated in the
spec: it attaches after the app has booted.

One measured constraint came out of building this, and it is documented in §4.10 rather than left for
the next game to find: an equirectangular source narrower than 64 px renders a physical material BLACK
with nothing logged anywhere, because the pre-filtered form three builds for it is sized from the
source.
