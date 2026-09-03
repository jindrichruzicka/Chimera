---
'@chimera-engine/electron': patch
---

Pin `ReplayPlaybackManager`'s playback cursor write.

`#projectedAt` keeps a mutable cursor, `active.lastTick`, and updates it after every projection. That
write is the bookkeeping the `step()` fast path reads on the _next_ call, and it was unpinned:
deleting the line left `replay-playback-manager.test.ts` green, and the whole
`electron/main/replay` directory with it.

Neither mutant is equivalent. With the write deleted the cursor stays at `baseTick`
forever, so the fast path fires on every call and each one steps the player forward — replaying the
same request twice serves a different frame each time. With the cursor set one ahead, a request two
ticks forward wrongly looks sequential and serves the frame before the one asked for.

The manager is constructed only in `electron/main/index.ts` and in its own suite, and the IPC
handler tests inject a fake `playback` port that never reaches `#projectedAt`. The existing cases
walk 0 → 1 → 2 and 3 → 1, so they never ask for the same tick twice and never skip forward by
exactly two from a fast-path position.

Three tests close it — a repeated `snapshotAt`, a repeated `snapshotRange` (the production-shaped
form, since the renderer prefetches ranges), and a skip-ahead-by-two — each run RED against its own
mutant first. The two mutants are not interchangeable: the repeat tests pass under the one-ahead
cursor and the skip-ahead test passes under the deletion, so neither alone closes the gap. No test
targets setting the cursor to `absoluteTick`; that mutant leaves the directory green, and the tick
both replay channels admit is validated by a `z.number().int().nonnegative()` schema. The manager
itself is unchanged.
