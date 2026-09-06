---
'@chimera-engine/action': patch
---

Add a per-beat benchmark for the realtime reference game.

`ActionBeatPerf.bench.test.ts` times the simulation leg of a beat —
`ActionPipeline.process()`, which runs the engine's tick reduce and then the app's `onBeat` hook
`advanceActionPrimitives` — and the app's own `action:set-velocity` reducer beside it. The existing
benches cover `ActionPipeline.process()` through tactics fixtures and the Stage-7 outbound wave; the
per-beat game work was timed by neither. The outbound wave stays the outbound bench's, so neither
file measures a whole beat alone.

It is the first gate to evaluate the rate-derived budget: the app declares `tickRateMs: 100`, so its
gates read `tickBudgetMsFor(ACTION_TICK_RATE_MS)` rather than the default-rate `TICK_BUDGET_MS`, and
a test pins that the two differ by the ratio of the periods — comparing the budget against
`tickBudgetMsFor(ACTION_TICK_RATE_MS)` would be a tautology a rate-ignoring implementation
satisfies.

Two widths. The shipped 3-primitive arena records the baseline and could not fail on any regression
short of a hang, which is why a synthetic 2000-entity arena runs beside it: making the beat hook
quadratic breaches the gate there. Each run logs median/p95/max against the budget rather than
freezing a figure in prose, and the percentile selection behind that log is pinned by its own test.
Every timed sample asserts it rewrote the entities record, so a fixture drift that parked the arena
cannot silently leave the bench measuring an early-out.
