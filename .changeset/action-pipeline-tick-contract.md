---
'@chimera-engine/simulation': patch
---

Assert the one-tick-per-action rule at the pipeline seam.

Invariant #42 says `GameSnapshot.tick` advances by exactly 1 per action applied by
`ActionPipeline.process()`. Three consumers depended on it and none could enforce it:
`ReplayPlayer.step()` throws a `DeterminismError` long after the fact, naming only the tick it
stopped at, and `replay-playback-manager` derives both `totalTicks` and its `step()` fast path from
the same rule. Stage 5 took `def.reduce`'s output verbatim, so a reducer that changed the snapshot
without touching the clock produced a match that played fine and a recording that could not.

`ActionPipeline` now checks it immediately after Stage 5 and throws a named `TickContractError`
whose message identifies the reducer at fault. The check is development-only — `NODE_ENV` is the
signal, which the packaging `define` bakes to `"production"` in a packaged bundle — so a violation
discovered after release cannot brick a shipped game. It still surfaces at replay time, where it
always did.

The rule is measured against `reduce`'s own output, and only for a reduce that ran alone. Four
cases are exempt, each with its own test: a reducer that returns its INPUT REFERENCE changed
nothing, so there is no action for the clock to count (`engine:save`, `engine:load`,
`engine:sync_request` and `engine:end_turn` with no `turnClock` all take this arm); `engine:undo`
and `engine:redo` are exempt by name, because a recorded undo reconstructs a prior state rather
than advancing; the check does not run on a nested dispatch; and a reduce that
dispatched children returns their cumulative advance rather than its own, which is what `engine:tick`
does when a timer fires.
