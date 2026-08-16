---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': minor
---

Add F84 — spatial audio: an explicit listener pose, an authored distance falloff, and
moving sources. `PlayOptions.position` becomes `PlayOptions.spatial` (a
`SpatialOptions` carrying the position plus `fullVolumeDistance` / `falloffDistance` /
`falloff` / `rolloffFactor`), mapping onto the voice's own `PannerNode` vocabulary
with no engine arithmetic. The engine default falloff is `'linear'` — deliberately
diverging from the platform's `'inverse'`, since only the linear model reaches zero at
`maxDistance` — and `panningModel` is pinned to `'equalpower'` and is not authorable.
Distances join the static validation tier: an inverted band, a negative or non-finite
distance or `rolloffFactor`, or a non-finite position component rejects synchronously
inside `play()` with an invalid handle and one warning, before any voice is reserved;
an equal pair is an authored hard cutoff realised as the narrowest expressible band
through a named power-of-two epsilon.

`AudioManager.setListener(pose, opts?)` writes the app's ONE listener — game-supplied,
never derived from a camera — over a feature-detected `AudioParam` path with a
`setPosition`/`setOrientation` fallback; the panner position writes share the same
feature-detected tier with their own `setPosition` fallback. Updates ramp over an
anti-zipper window unless `{ immediate: true }`. `AudioManager.setVoicePosition` moves a live spatial
voice (ramped or immediate), parks a move on a loading
voice's record for `t0` with last-write-wins, warns once and no-ops on a non-spatial
voice, and stays silent on a released handle. `useSpatialAudio()` exposes both verbs
from the existing `@chimera-engine/renderer/audio` barrel — no new subpath — together
with the spatial option types.

Event-driven SFX gain a per-occurrence seam: `GameEventAudioBinding` entries accept
`options?: (event) => EventAudioOverrides`, a sim-side primitives-only overrides type
merged over the static fields, contained per event when it throws. It cannot produce a
position; positioned event SFX use explicit call sites, and Tactics is the reference
adopter — board SFX at the acting unit's world position with the listener anchored at
the board focus, never the camera. No spatial code path writes any gain stage
(Invariant #116 re-verified; the spatial rules are new Invariant #134).
