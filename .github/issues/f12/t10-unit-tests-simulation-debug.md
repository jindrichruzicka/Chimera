> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Write a comprehensive unit-test suite for the three pure `simulation/debug/` modules:
`SnapshotRingBuffer`, `SnapshotDiff`, and `SnapshotInspector`. Tests live alongside
their implementation files (or in a co-located `__tests__/` directory, consistent with
existing test placement in the repo). Each module's tests should be independent and
runnable in isolation. Tests for `SnapshotInspector` must cover the ring-buffer
fast-path, the memento-reconstruction fallback, projection delegation, filtered action
logs, perf stats accuracy, and `DebugReconstructionError` on missing memento.

## Implementation notes

- Test files: `simulation/debug/SnapshotRingBuffer.test.ts`, `simulation/debug/SnapshotDiff.test.ts`, `simulation/debug/SnapshotInspector.test.ts`
- Use existing test framework and conventions already in the repo (Vitest or Jest — check existing test files)
- `SnapshotInspector` tests require minimal stub implementations of `StateProjector`, `StateReducer`, `ActionHistory`, and `TurnMemento`
- Must NOT import from: `renderer/`, `electron/`, `games/*` (module boundary for test files under `simulation/`)

## Acceptance Criteria

- [ ] `SnapshotRingBuffer` tests: circular overwrite, `get()` in-buffer/out-of-buffer, `allTicks()` sort, `onRecord` fires once per record
- [ ] `SnapshotDiff` tests: added keys, removed keys, changed primitives, nested dot-notation paths, correct `summary` counts
- [ ] `SnapshotInspector.listTicks()` returns correct `TickEntry[]` with `inRingBuffer` flags
- [ ] `SnapshotInspector.getSnapshot()` ring-buffer fast-path verified
- [ ] `SnapshotInspector.getSnapshot()` memento-reconstruction path verified (including multi-action replay)
- [ ] `SnapshotInspector.getProjection()` delegates to `StateProjector.project()` with correct args
- [ ] `SnapshotInspector.getActionLog()` filters by `fromTick` and `toTick`
- [ ] `SnapshotInspector.getPerfStats()` returns non-zero avg/max when buffer has ≥ 2 entries
- [ ] `DebugReconstructionError` thrown when no `TurnMemento` exists at or before the tick
- [ ] All tests pass (`pnpm test`)

## Invariants touched

- Invariant 2: Test imports must not introduce any `renderer/`, `electron/`, or `games/*` dependencies into `simulation/debug/`
