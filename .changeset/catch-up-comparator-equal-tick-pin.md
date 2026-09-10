---
'@chimera-engine/renderer': patch
---

Pin the catch-up comparator in `bootstrapGameStore` on an equal-tick boundary.

When `getCurrentSnapshot()` resolves a snapshot on the same tick as one already applied from the
live stream, the catch-up is discarded and the live snapshot stands. Every fixture before this one
put the two snapshots on different ticks, so loosening the comparator to `>=` went unnoticed. The
new case delivers two structurally equal snapshots as distinct objects on one tick and asserts, by
identity, that the store holds the live one. No production code changes.
