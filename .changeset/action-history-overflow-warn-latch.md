---
'@chimera-engine/simulation': patch
---

Latch the `action-history:overflow` report so a saturated history reports once per episode, not once
per append.

`InMemoryActionHistory.append()` warned inside its eviction branch, and that branch is taken on
every append once the history is full. For a turn-based game that is nearly free: `pruneTo` runs on
`engine:end_turn` and keeps the history far below its cap, so the warn fires only when pruning is
genuinely broken — which is what it was written for.

A game that dispatches no `engine:end_turn` never runs that prune, so the cap is the bound it
operates against: the history fills, and every append after that evicts.

Saturation is a state transition — retention has just become lossy — not a per-append event. A
private latch is raised on the first eviction — not on reaching the cap, since a full history that
has dropped nothing is still lossless — and re-armed by a `pruneTo` that drops the live size back
below capacity, so a turn-based game that saturates, prunes and saturates again still
reports each episode. Only a prune that actually FREES space re-arms it: `pruneTo` with a cutoff
that evicts nothing leaves the history saturated, so nothing transitioned and the next append must
not re-report the same episode.

Eviction itself is untouched — every overflowing append still drops its oldest entry, and the
`sinceLastMemento()`, head-cursor and compaction bookkeeping are unchanged. Only the reporting
cadence moves. The log key `action-history:overflow` and its `capacity` field are unchanged too.

Invariant #45 is amended to state the cadence rather than implying one warn per eviction, and
`electron/main/__tests__/logger-wiring.integration.test.ts` now drives the real host pipeline 200
appends past the cap and pins exactly one warn — a pipeline that never prunes is the condition that
made the cadence matter, and no unit test constructs it.
