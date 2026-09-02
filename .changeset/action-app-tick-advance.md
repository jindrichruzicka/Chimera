---
'@chimera-engine/action': patch
---

Advance the tick in the action app's reducers, so a recorded match replays.

`action:set-velocity` and `action:select-primitive` both returned a changed snapshot carrying the
input tick through, violating Invariant #42 — `GameSnapshot.tick` advances by exactly 1 per action
applied by `ActionPipeline.process()`. Nothing in a live match notices, because the pipeline takes
`reduce`'s output verbatim. The consequence surfaces only when the recording is opened:
`ReplayPlayer.step()` refuses the first such entry with `DeterminismError: replay action at tick 0
advanced to 0 instead of 1`. Both reduce returns now write `tick: state.tick + 1`.

`action:select-primitive` also accepted a click on the primitive the acting seat already drives,
while its reduce returned the input reference for it. `HostSessionPipeline.processAction` is where
an applied action meets the replay recorder, so that click was the same unreplayable entry by
another route. `validate` now refuses it with `already_controlled`; the click stays a no-op on
screen, as it always was, and `ActionPrimitiveMesh` no longer reports that click at all, so the
refusal is a guarantee rather than something a player trips on every pick.

The reducers' remaining no-op arms are unchanged: each returns the input reference without touching
the tick, and each is refused by `validate`, so none can reach a recording. The per-beat movement
pass `advanceActionPrimitives` is untouched — it runs inside `engine:tick`'s own reduce, which has
already advanced, and it still returns the input reference when nothing moved.
