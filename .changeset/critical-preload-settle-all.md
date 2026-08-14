---
'@chimera-engine/renderer': minor
---

`AssetManager.preloadCritical` now attempts every `critical` manifest entry instead of
abandoning the list at the first rejection, and each broken ref is reported by name.

The match-level warm-up (`startCriticalAssetPreload`) awaited its entries in sequence and let
the first rejection propagate, so one broken critical ref left every entry after it unloaded by
that run. Those fell back to loading on demand — the pop-in `priority: 'critical'` exists to
prevent.

The run still rejects once every entry has settled, now with a
`CriticalAssetPreloadFailedError` carrying the refs that failed and the first cause. Because
attempting all of them means the run cannot settle before its slowest entry, and this arm has
no budget, `preloadCritical` takes an optional third argument — `onEntryFailure(ref, error)` —
that fires as each broken ref settles. That is what the renderer log entry is emitted from, so
one unanswered fetch beside one broken ref no longer withholds the report.

The sequence is deliberately kept: the defect was the abandonment, not the ordering, and the
load order is observable and pinned. A failed entry now advances the progress fraction, which
measures how much of the list has settled.
