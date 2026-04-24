> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Implement `SnapshotInspector` and its supporting types/errors in
`simulation/debug/SnapshotInspector.ts`. The class is a facade that hides ring-buffer
lookup vs. memento-replay reconstruction behind a single API. It exposes six public
methods: `listTicks()`, `getSnapshot(tick)`, `getProjection(tick, playerId)`,
`diff(fromTick, toTick)`, `getActionLog(fromTick?, toTick?)`, and `getPerfStats()`.
O(1) access for buffered ticks; O(n-in-turn) reconstruction for unbuffered ones.
Include `DebugReconstructionError` for failed reconstructions. Write unit tests covering
all six methods, the ring-buffer fast-path, the memento-replay fallback, projection
delegation to `StateProjector`, and `DebugReconstructionError` when no memento exists.

## Implementation notes

- File to create: `simulation/debug/SnapshotInspector.ts`
- Depends on: `SnapshotRingBuffer` (T2), `SnapshotDiff` (T3) — must be completed first
- Must NOT import from: `renderer/`, `electron/`, `games/*` (module boundary)
- Constructor takes: `ringBuffer`, `mementos: TurnMemento[]`, `history: ActionHistory`, `reducer: StateReducer`, `projector: StateProjector`
- `reconstructFromMemento` finds the most recent `TurnMemento` at or before `tick`, then replays actions up to `tick`
- Export `SnapshotInspector`, `TickEntry`, `PerfStats`, `DebugReconstructionError` from `simulation/debug/index.ts`

## Acceptance Criteria

- [ ] `listTicks()` returns all history entries as `TickEntry[]` with correct `inRingBuffer` flag
- [ ] `getSnapshot(tick)` returns ring-buffer entry directly (O(1)) when in buffer
- [ ] `getSnapshot(tick)` reconstructs from nearest `TurnMemento` when not in buffer
- [ ] `getProjection(tick, playerId)` delegates to `StateProjector.project()` on the resolved snapshot
- [ ] `diff(from, to)` delegates to `computeSnapshotDiff` with correct snapshots
- [ ] `getActionLog(fromTick?, toTick?)` filters `ActionHistory.entries()` correctly
- [ ] `getPerfStats()` returns correct avg/max tick duration from ring buffer data
- [ ] `DebugReconstructionError` is thrown when no `TurnMemento` exists at or before the requested tick
- [ ] Unit tests pass for all of the above
- [ ] No forbidden cross-module imports (verified by lint)
- [ ] §12 M7 checklist item "SnapshotInspector implemented in simulation/debug/" is green

## Invariants touched

- Invariant 2: `simulation/debug/` must have zero imports from `renderer/`, `electron/`, or `games/*`
