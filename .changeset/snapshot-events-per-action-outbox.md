---
'@chimera-engine/simulation': patch
'@chimera-engine/renderer': patch
---

Give `snapshot.events` a retention rule and enforce it: it is a per-ACTION outbox, drained by
`ActionPipeline.process()` before every outer action's reduce.

Nothing cleared `events` before this. The field is in `BASE_SNAPSHOT_KEYS`, so `baseSnapshotOnly()`
carried it across both match boundaries and it accumulated for the life of a SESSION — riding into
every projected `PlayerSnapshot`, every broadcast and every save checkpoint the body checksum
covers.

The rule is enforced per action rather than per beat, which is what the issue proposed. Measured:
`resolveTickerHz` returns `null` for a `realtime: false` manifest, so outside the `CHIMERA_E2E`
forced-interval seam the host builds no `RealtimeTicker` for such a game — and
`apps/tactics/simulation/actions.ts`, which appends events, sits under exactly such a manifest.
Clearing inside the `engine:tick` reduce would therefore have left a shipped session of it
accumulating while the docs claimed a bound. Per action also makes the documented contract literally
true: `tick` is "+1 per applied action", so "all events this tick" and "one action's events" are the
same sentence.

The drain is gated on `#depth === 0`, so a fired timer's nested dispatch adds to the outer action's
outbox rather than replacing it. Every later comparison in the frame reads the DRAINED value, which
is what keeps `#isClockOnlyTick` seeing an idle beat as idle — including the first beat after an
eventful one — so the tick-only broadcast branch stays engaged. The drained array is one shared
frozen constant: an in-place append, already forbidden by Invariant #43, throws at the offending
line instead of contaminating every later drain.

`EventAudioPlayer` tracked a played COUNT, which only works while the array grows; under a drained
outbox that silently drops any batch no longer than the one before it. It now plays each batch whole
and keys its ref on the array's IDENTITY, so a re-render carrying a new `binding` object plays
nothing.

`GameEvent`'s shape is unchanged, and `StateProjector` filters per viewer exactly as before.
