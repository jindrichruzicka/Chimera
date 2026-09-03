---
'@chimera-engine/simulation': patch
---

Refuse undo when eviction has dropped entries recorded since the turn memento.

`InMemoryUndoManager.undo()` replays `sinceLastMemento()` on top of `memento.snapshotAtTurnStart`.
`InMemoryActionHistory` evicts by advancing a head cursor, and `#clampMementoBoundary()` drags the
memento boundary up with it — so once eviction passes the boundary, the tail `sinceLastMemento()`
returns begins later than the baseline it is relative to. The entries in between are gone, and
`undo()` replayed the remainder onto the stale baseline and returned a snapshot that is neither the
pre-undo state nor any state the match had been in, with no error.

Two evictors reach that clamp: the `MAX_ACTION_HISTORY_ENTRIES` overflow cap in `append()`, and
`pruneTo()` walking past the boundary. A realtime game is where the cap bites — it dispatches no
`engine:end_turn`, so it neither prunes nor re-takes a memento, and the cap is the bound it operates
against.

`ActionHistory` gains `hasEvictedSinceMemento(): boolean`. It is a required member, so every
implementer must add it. `InMemoryActionHistory` raises the flag where `#clampMementoBoundary()`
actually moves the boundary, and clears it on the next `markMementoBoundary()` — a fresh baseline is
anchored to the live tail, so an earlier gap is no longer in front of the segment.

`canUndo()` returns `false` while the flag holds and the player is reading the shared history, so the
projected `undoMeta` stops advertising undo, and `undo()` throws `UndoNotAllowedError`. Its `reason`
is the existing `not_enough_history` rather than a new code: the entries between the baseline and the
surviving tail are exactly the history the undo needs and no longer has. Re-anchoring the memento is
deliberately not attempted — that would need a snapshot the manager does not hold, and refusing is
the honest answer.

A player who has already undone reads their own virtual history, which the manager owns and which
was captured while the segment was whole, so their undo is unaffected. Eviction that has only reached
entries recorded _before_ the memento is unaffected too — the segment undo replays is still intact.
