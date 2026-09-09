---
'@chimera-engine/renderer': patch
---

Publish curated renderer configuration on `GameCanvas`.

`GameCanvasProps` gains `shadows`, `toneMapping`, `toneMappingExposure`, `outputColorSpace` and
`renderScale`, and the r3f barrel publishes `ShadowQuality`, `ToneMappingMode`, `OutputColorSpace`
and `RenderScale` as types. Every value is an engine-owned NAME, so a game configures the renderer
while importing neither `Canvas` nor `three` — Invariant #127 bans the `Canvas` binding from game
files, and this is what makes the ban liveable rather than merely restrictive. The name to
`three`-constant mapping lives in `renderer/components/r3f/rendererConfig.ts` and stays
renderer-internal; the types ship, the constants do not.

Omitting the props reproduces the rendering the canvas had before they existed. `shadows` and
`renderScale` ride r3f's own `shadows` / `dpr` props and both keys are OMITTED rather than
defaulted, so r3f applies its own defaults; the three colour fields are never written.

The colour trio is not a Canvas prop. The alternative is handing r3f a raw `gl={…}` object, which
is the pass-through shape Invariant #127 keeps out of game files — so the curated props carry the
concern, and `GameCanvas` applies these three from a null component mounted inside the `<Canvas>`,
where the renderer is R3F root state. A change to any of them takes effect without remounting the
canvas, measured one case per knob. A renderer has no unset state, so dropping the prop afterwards
leaves the last authored value standing; that limit is documented on the prop and pinned by a test.

Every prop is per canvas, so an `overlay` can be configured more cheaply than the `main` scene it
sits over.
