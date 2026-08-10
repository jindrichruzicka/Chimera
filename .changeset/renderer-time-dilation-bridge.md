---
'@chimera-engine/renderer': minor
---

Add `useAnimationTimeScale` to the public r3f barrel (`@chimera-engine/renderer/components/r3f`)
and make authoritative time dilation reach every mounted clip on its own (F82).

A host that dilates a match sets one optional integer on the snapshot,
`timeScalePermille` — 1000 is real time, 250 quarter speed. `GameShell` now mounts an internal
`TimeScaleBridge` that carries that integer into a one-float renderer store, whose multiplier
is derived only through the shared `timeScaleMultiplier`, so the host's beat period and the
renderer's clip rate stay reciprocal by construction and the `[50, 4000]` clamp plus the
fractional-permille refusal keep a single definition (Invariant #130). The bridge is the store's
sole writer, takes the permille as a prop, and carries nothing back (Invariant #131). No
`exports` subpath is added; the barrel set is unchanged at eight.

`useClipPlayer` follows that multiplier by default, so a dilated match slows every clip with no
wiring in the game at all; `options.timeScale` still overrides it for a clip that must ignore a
global slow-motion. `useAnimationTimeScale()` returns the same multiplier as a plain number, and
is what everything a game animates by hand — a camera tween, a particle rate, a shader uniform,
a HUD countdown — opts in with. **Clip playback is what dilates, never the R3F clock:** the clock
feeds `PerfProbe`, and scaling it would make the performance HUD report a frame rate the player
never saw.

**Rule ONE-MIXER-PER-ROOT is now reported rather than only documented.** `useModelAnimation` and
`useClipPlayer` each own an `AnimationMixer`, and two of them bound to one model root advance
the same actions twice a frame — the clip plays at a multiple of its speed and every wrap is
miscounted, with no other symptom. Both hooks now claim the root in an internal per-root
registry for exactly as long as they hold a mixer, and a root still carrying two of them one
frame later produces a named `DuplicateMixerBindingError` through the renderer log bridge,
naming both binders. Logged, never thrown (Invariant #67): R3F's `ErrorBoundary` re-throws
outward past the `<Canvas>`. A pair that merely overlaps and resolves — one of the two
unmounting before the frame — is not reported, and neither is a StrictMode remount.
