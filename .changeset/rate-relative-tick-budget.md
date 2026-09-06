---
'@chimera-engine/simulation': patch
'@chimera-engine/tactics': patch
---

Derive the `ActionPipeline` tick budget from the game's declared tick rate.

`TICK_BUDGET_MS = 16` was documented as "≤ 16 ms at 20 Hz" but was parameterised by nothing, while
`resolveTickerHz` accepts any finite positive `tickRateMs` (100 Hz is pinned as correct in
`game-manifest-contract.test.ts`). A game declaring a 10 ms period was therefore gated against a
budget larger than its entire beat — a gate that could not fail.

`tickBudgetMsFor(tickRateMs)` now returns `TICK_BUDGET_DUTY` (0.32) of the declared period, and
`TICK_BUDGET_MS` is derived from `DEFAULT_TICK_RATE_MS`: it is still 16, so no existing gate's
number moved. The duty is locked by a test the way the heap budgets are, so changing the engine's
headroom policy is a deliberate act. `tickBudgetMsFor` throws a `RangeError` on a non-finite or
non-positive period, mirroring `resolveTickerHz`'s refusal of the same inputs, and accepts a
fractional one, as `resolveTickerHz` also does.
