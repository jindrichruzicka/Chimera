---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': minor
'@chimera-engine/electron': minor
'@chimera-engine/ai': minor
'@chimera-engine/networking': minor
'create-chimera-game': minor
---

A clip change can now blend, and a finished clip stays on its last frame.

`useClipPlayer` takes a `blendSeconds` option: the seconds to blend out of whatever was
playing and into the newly declared clip. A clip may also declare the length once, in its
manifest sheet, as `blendInSeconds`. Omitting the option falls back to that authored
length, and to no blend when the sheet declares none — so a game that declares neither
keeps the cut it has today. A `blendSeconds` at the call site overrides an authored one,
including with a `0`, which asks for a cut. Both are wall-clock seconds and neither
scales with the dilation multiplier, so a transition takes as long in a slowed-down scene
as it does at full speed.

`AnimatedSprite` and `useSpriteClipPlayer` deliberately do NOT take `blendSeconds`: a
sprite playback rewrites quad UVs and has no weight to interpolate. A sprite clip's sheet
may still author `blendInSeconds` — the sheet is shared vocabulary — and no sprite
backend honours it.

Behaviour an adopter sees without asking for anything:

- A clip change now closes the outgoing clip's open passages with reason
  `'clip-changed'` instead of `'stopped'`, whether or not a blend was asked for. A
  `loop` change and a `sheet` change do the same. `'stopped'` now means what a caller
  asking for a stop gets — `stop(name)`, `stopAll()`, or declaring `clip: null` — and
  `'released'` still means the player was disposed. A game switching on
  `PassageEndEvent.reason` should read the new value.
- A `'once'` clip that reaches its end now HOLDS its last frame instead of restoring the
  model's original state on the same tick its `clip-end` handler runs. The pose comes
  down when something asks the player for a change — including declaring another clip,
  which blends out of the held frame when it declares a blend and cuts it when it does
  not.

An authored `blendInSeconds` that is not a finite number of at least zero now fails
`validate-assets` at build time, naming the clip, and is dropped with a warning by the
runtime sheet parser if it reaches one.
