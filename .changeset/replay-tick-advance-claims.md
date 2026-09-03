---
'@chimera-engine/electron': patch
---

Correct the replay tick-advance claims: the `step()` fast path rests on a refusal, not a guarantee.

`replay-playback-manager` stated the one-tick rule as a property of recordings — "every recorded
action advances the tick by exactly 1 (Invariant #42)" — and derived both `totalTicks` and the
`step()` fast path from it. That sentence was already false before it was written: §4.28 records
that a recorded `engine:undo` does not advance the tick and does not replay, and a recorded action
whose reducer dispatches a child advances by more than 1.

Nothing about the manager's behaviour changes; the reason it is sound does. `ReplayPlayer.step()`
throws `DeterminismError` unless the pipeline advanced by exactly +1, so it returns either the
snapshot at `lastTick + 1` or `null` — never one at an unexpected tick, so `lastTick` cannot
desynchronise. The manager suite
now reaches both refusals: a reducer that CHANGES the snapshot without advancing is caught inside
`process()` by the development-only tick-contract check, and one that returns its INPUT REFERENCE is
exempt there and refused by `step()`, whose comparison reads no build flag. Deleting that comparison
from the built simulation makes the second case serve a snapshot at the wrong tick, and the test
says so.
