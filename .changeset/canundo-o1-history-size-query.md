---
'@chimera-engine/simulation': patch
---

Answer `UndoManager.canUndo` from an O(1) history size query instead of a copy of the entry list.

`canUndo` only asks whether the effective undo segment is non-empty, but it read that segment through
`getEffectiveEntries()` → `ActionHistory.sinceLastMemento()`, which slices the live history into a
fresh array. It sits on the per-viewer broadcast projection path — `ActionPipeline` Stage 7 projects
once per seated player, and `StateBroadcaster.fanOutToSpectators` projects again for each spectator's
followed seat — and in a game that dispatches no `engine:end_turn` the segment is never re-based by a
memento boundary, so its length grows to the `MAX_ACTION_HISTORY_ENTRIES` safety net.

`ActionHistory` gains `sizeSinceLastMemento(): number`. This is a required member, so any external
implementer of the interface must add it; `InMemoryActionHistory` is the only implementer in this
repo. It and `sinceLastMemento()` now both derive their start index from one private accessor, so the
count describes exactly the array the slice would produce.

`canUndo` reads the per-player virtual history's length when an undo has already diverged it from the
shared history, and the size query otherwise. Every short-circuit — policy `allowUndo`, a missing
memento, `maxUndoSteps` — keeps its previous order, so the projected `undoMeta.canUndo` is unchanged.
`undo()` still calls `sinceLastMemento()`: it genuinely replays the entries.
