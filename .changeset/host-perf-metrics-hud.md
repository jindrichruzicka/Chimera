---
'@chimera-engine/simulation': patch
'@chimera-engine/electron': patch
'@chimera-engine/renderer': patch
---

Report host heap and recorded-action count in the Performance HUD.

`PerfSample`'s `heapMb` is the RENDERER's `performance.memory`, so a host-side buffer could grow to
any size with the HUD unchanged. Two new fields carry the host's own numbers: `hostHeapMb` from
`process.memoryUsage().heapUsed`, and `recordedActionCount` from a new
`ReplayManager.recordedActionCount()` over the live deterministic recording.

They arrive on a new `chimera:game:host-metrics` push driven by main's own 1 Hz timer
(`startHostMetricsPush`), never per beat — at a beat rate the push would be the cost it measures.
Only scalars cross (Invariant #3), and the payload is schema-validated at the preload boundary.

Both fields are `number | null` where `null` means UNAVAILABLE — no push yet, or no recording
running — and the HUD renders it as `—`. A started recording holding no actions reads `0`, which is
a different row. `PerfStats.totalActionCount` remains what it was: the debug bridge's own array
length, capped and constant once saturated, and absent from a shipped game.

§13.5 now records what actually executes where. The timing gates run on CI, because the bench files
sit under `apps/*/__tests__/` and `pnpm -r test` collects them. The heap case does not: it is
guarded on `globalThis.gc`, which only `--expose-gc` provides and only `npm run test:perf` sets.
