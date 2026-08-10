---
'@chimera-engine/simulation': minor
---

Add the animation clip-sheet authoring vocabulary, the shared time-scale arithmetic and the
content-load window verifier — the first of the animation layer (F82), and the half that lives
in the zero-dependency simulation leaf.

`@chimera-engine/simulation/content` gains `modelAnimationEntry`, `spriteAnimationEntry`,
`compileAnimationWindows`, `beatsForRealSeconds` and `AnimationWindowMismatchError`, plus the
sheet types below. The two builders are twins of the existing `audioClipEntry`:
each builds a `'gltf-model'` / `'sprite-sheet'` manifest entry and stores an optional clip
sheet in the `AssetManifestEntry.metadata` slot verbatim, by reference, never inspecting it —
and omits the `metadata` key entirely when none is passed, so an entry from the builder
deep-equals a hand-authored one. `AssetManifestEntry.metadata` stays typed `unknown`; the sheet
is structurally opaque to `simulation/` and `ai/`, and the playback parser is the renderer's.

The sheet types themselves — `AnimationClipName`, `AnimationMarkName`, `AnimationWindowName`,
`AnimationLoopMode`, `ClipPosition`, `AnimationNotify`, `AnimationPassage`,
`AnimationTrackSheet`, `ModelAnimationMetadata`, `SpriteClipDeclaration` and
`SpriteAnimationMetadata` — are declared in `simulation/foundation/animation-clip-sheet.ts`,
mirroring `audio-cue-sheet.ts`: pure type declarations with zero runtime, asserted by an esbuild
pin that the module bundles to the empty string. A `ClipPosition` is a normalized phase, an
absolute `{ seconds }`, or a `{ frame }` index. `AnimationLoopMode` is `'once' | 'loop'` and
deliberately has no ping-pong member — nothing downstream models a reversing playhead, so it is
refused at the type level rather than clamped later.

`compileAnimationWindows(sheet, clipName, tickRateMs)` is the reason the visual span and the
mechanical one are authored twice. A passage carries clip-relative `from`/`to` positions and,
optionally, the `[startBeat, endBeat]` integers the simulation will open a gameplay window on.
The verifier recomputes the second from the first under outward rounding —
`startBeat = floor(from)`, `endBeat = max(startBeat + 1, ceil(to))`, in beats — and throws
`AnimationWindowMismatchError` (carrying the clip, the passage and both tuples) when the two
disagree, returning the **authored** tuple by reference when they agree. It verifies rather than
derives on purpose: deriving would make the length of every hit window in a game a function of
the host pacing knob `tickRateMs`, so raising the tick rate would silently retune combat. The
`max(startBeat + 1, …)` term is the structural one-beat floor — at the default 20 Hz beat the
finest expressible mechanical window is one beat, and a narrower authored span is floored at one
rather than collapsing to the empty window `[n, n]`. Beat quotients are snapped by a 1e-9 epsilon
before rounding, because resolving a frame or a phase multiplies two floats and lands a hair off
a beat in either direction. An authored bound that is not a non-negative integer, a
`tickRateMs` that is not a finite positive number, and a position the clip cannot resolve are
each a `RangeError`. `beatsForRealSeconds(realSeconds, tickRateMs, scalePermille)` is the same
arithmetic the other way round, counting the beats of the dilated period a wall-clock span
occupies; it divides by `dilatedBeatPeriodMs` rather than re-deriving the division.

`simulation/foundation/time-scale.ts` holds the time-dilation arithmetic:
`NORMAL_TIME_SCALE_PERMILLE` (1000), `MIN_TIME_SCALE_PERMILLE` (50), `MAX_TIME_SCALE_PERMILLE`
(4000), `clampTimeScalePermille`, and the pair `timeScaleMultiplier` (the renderer's clip
playback multiplier) and `dilatedBeatPeriodMs` (the host's declared beat period). Both divide by
the same clamp result, so the two halves of a dilated hit cannot drift apart independently.
`clampTimeScalePermille` applies two distinct rules in order: anything that is not a finite
integer — `undefined`, `NaN`, `±Infinity`, or a fractional permille such as `2.5` — falls back to
real time, and only then is a finite integer clamped into `[50, 4000]`. A fraction is refused
rather than rounded, because silently turning `2.5` into the 5%-speed floor reads as a
slow-motion bug rather than as the typo it is.

That module carries runtime values, so it is exported from no barrel: the package root and
`@chimera-engine/simulation/contracts` are both asserted to bundle to the empty string, and
re-exporting it from either would break that. It is reached through its own
`@chimera-engine/simulation/foundation/time-scale.js` subpath, resolved by the `./*.js` wildcard
already in the exports map — the same route `foundation/crc32.js` and
`foundation/asset-ref-parse.js` already take. No exports-map entry was added.

Additive throughout; nothing is removed, renamed or narrowed, and no snapshot type changes.
The build-time half — `validate-assets`' `invalidAnimationSheets` gate over the sheets these
builders write — lands in `@chimera-engine/electron`.
