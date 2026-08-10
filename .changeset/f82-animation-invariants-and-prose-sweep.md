---
'@chimera-engine/simulation': minor
'@chimera-engine/ai': minor
'@chimera-engine/networking': minor
'@chimera-engine/renderer': minor
'@chimera-engine/electron': minor
'create-chimera-game': minor
---

Close the animation system (F82): author the two remaining invariants, and amend the prose the
code falsified.

**Invariant #129** (the last reserved slot, now authored) states that beat-owned gameplay windows
are host-only — `StateProjector.project()`'s field allowlist omits the registry, so no window
record ever crosses a boundary — that records are integer or `FixedPoint` throughout because the
registry is saved and replayed, that `AnimationWindowManager`'s three verbs are pure, and that
within a match a window leaves through one of the manager's FOUR paths, each reported with a
distinguishing reason: `'expired'`, `'owner-gone'` (checked first, so it stays the truthful reason
on the beat the countdown would also have run out), `'replaced'` and `'interrupted'`. The MATCH
BOUNDARY is deliberately named as not being one of them — `animationWindows` is match-scoped, so
`engine:start_game` and `engine:return_to_lobby` drop the whole registry with no per-window event,
in the same reduce that drops a game's own extension fields.

**Invariant #132** states as a numbered rule that no animation event may gate an
`EngineAction`. A clip's marks report where a playhead is, and a gameplay consequence derived
from one would be derived from the frame clock, which no two machines share. The rule is held by
ABSENT PARAMETERS — `ClipMarkerHandlers` and every event it carries name no dispatcher, no
`SendAction`, no `PlayerId` and no tick — so a handler has nothing to dispatch with. Stated as an
invariant rather than left to be inferred from one hook's signature, because a future animation
surface adding a parameter would be adding it to a shape no rule had claimed.

The prose sweep is the other half, and it is about one word. `GameSnapshot.tick` counts ACTIONS,
not beats: an `engine:tick` that fires a timer dispatches children through the same
`ActionPipeline.process()`, and each one advances the counter. Every doc line that treated the
two as the same number is amended — most importantly the action-pipeline claim that "each
`engine:tick` advances the counter by 1", which is exactly what would make a `tick`-difference
animation clock look correct. `ReplayPlayer`'s "+1 tick per recorded action" is restated as what
it is, a REFUSAL that bounds what is replayable (a nested `ctx.dispatch` and `engine:undo`/`redo`
are not), and the two measurably-false replay lines are deleted rather than sharpened.

No runtime behaviour changes: this is the documentation and invariant half of a feature whose
code landed across the tasks before it, plus one new engine-side test pinning #132's parameter
census.
