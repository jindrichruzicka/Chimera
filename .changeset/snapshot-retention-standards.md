---
'@chimera-engine/action': patch
---

Write the snapshot retention rules into the simulation-layer standards, and add the per-beat
outbound baseline they are measured against.

`docs/coding-standards-sections/simulation-layer.md` gains §7.5: `events` is a per-action outbox; a
fired one-shot leaves `timers` in the beat that fired it while a `cancel()`ed entry stays until a
`create()` under the same id replaces it (`timers` is in `BASE_SNAPSHOT_KEYS`); a new
snapshot-resident collection declares its retention on the field where it is added; and retention
always produces a new snapshot (Invariant #43). §4.2 and §4.20 point at the rules rather than
restating them.

The baseline the section quotes is measured in-tree rather than restated from an audit: the new
`apps/action/__tests__/OutboundPerBeatPerf.bench.test.ts` times what Stage 7 costs the host per
eventful beat — `StateProjector.project()`, then `JSON.stringify` and `crc32` of the projection,
once per viewer — at 500 × 4 and 2000 × 8 (entities × viewers) over the action app's shipped
visibility rules, logs the numbers on every run, and is part of `pnpm test:perf`. The 500 × 4 grid
is gated against `TICK_BUDGET_MS`; the 2000 × 8 grid is logged only and compared against nothing.
