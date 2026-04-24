> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Implement `SnapshotRingBuffer` in `simulation/debug/SnapshotRingBuffer.ts` exactly as
specified in §4.12. The class records the last N `GameSnapshot`s (default capacity 200,
configurable via `CHIMERA_DEBUG_BUFFER_SIZE`) using a circular overwrite strategy. It
exposes `record(tick, snapshot)`, `get(tick)`, and `allTicks()`. The optional
`onRecord` callback fires after every successful record — this is the live-push hook
wired by `debug-bridge.ts` for the `SUBSCRIBE_LIVE` path. Include a full unit-test
suite verifying circular overwrite, `allTicks()` sort order, `get()` for in-buffer and
out-of-buffer ticks, and the `onRecord` callback behaviour.

## Implementation notes

- File to create: `simulation/debug/SnapshotRingBuffer.ts`
- Must NOT import from: `renderer/`, `electron/`, `games/*` (module boundary)
- `RingBufferEntry.recordedAt` uses `Date.now()` — this is wall-clock ms for perf stats only, NOT simulation time; it does not affect determinism
- Export `SnapshotRingBuffer` and `RingBufferEntry` from `simulation/debug/index.ts`

## Acceptance Criteria

- [ ] Circular overwrite: capacity-N buffer overwrites oldest entry when full
- [ ] `get(tick)` returns `undefined` for ticks not in the current window
- [ ] `allTicks()` returns ticks sorted newest-first
- [ ] `onRecord` callback fires exactly once per `record()` call when set
- [ ] Unit tests pass for all of the above
- [ ] No forbidden cross-module imports (verified by lint)
- [ ] §12 M7 checklist item "SnapshotRingBuffer implemented in simulation/debug/" is green

## Invariants touched

- Invariant 43: `SnapshotRingBuffer.record()` must not call `Math.random()` or `Date.now()` for simulation-time purposes (wall-clock `recordedAt` is acceptable for perf stats only)
