## Summary

Implements the full Runtime Debug Layer for the Chimera engine: a debug-only subsystem
that gives engine and game developers authoritative visibility into the running simulation.
The layer captures every historical `GameSnapshot` via a ring buffer, provides a structured
query/diff API through `SnapshotInspector`, and exposes all of it through a dedicated
Inspector Window with six information panels. The entire module is absent in production
builds — compile-time dead-code elimination via `IS_DEBUG_MODE` ensures zero footprint
and zero information-exposure risk for end players.

> Architecture: §4.12 — `Runtime Debug Layer (simulation/debug/ + electron/main/debug-bridge.ts)`

## Scope

**In scope:**

- `shared/constants.ts`: `IS_DEBUG_MODE` constant driven by `CHIMERA_DEBUG` env var
- `simulation/debug/SnapshotRingBuffer.ts`: observer that records the last N `GameSnapshot`s after each `ActionPipeline` step
- `simulation/debug/SnapshotDiff.ts`: structural diff of two `GameSnapshot`s (added / changed / removed fields)
- `simulation/debug/DebugProtocol.ts`: typed request/response message shapes for the `chimera:debug` IPC channel
- `simulation/debug/SnapshotInspector.ts`: facade/query API — list ticks, get/reconstruct snapshots, project to a `PlayerId`, diff, action log, perf stats
- `simulation/engine/ActionPipeline.ts`: optional `debugObserver` hook between step 5 (reduce) and step 7 (broadcast)
- `electron/main/debug-bridge.ts`: spawns Inspector Window, wires `SnapshotInspector` to the `chimera:debug` IPC handler
- `electron/preload/debug-api.ts`: `window.__chimeraDebug` bridge for the Inspector Window
- `renderer/app/debug/page.tsx`: Inspector Window React app with Timeline, Snapshot Inspector, Projection Explorer, Diff View, Action Log, and Performance panels
- Unit tests for all `simulation/debug/` modules
- Security test: IPC handler rejects requests from non-Inspector `webContents.id`
- Production build verification: `window.__chimeraDebug` absent from the game renderer window

**Out of scope (explicit non-goals):**

- Remote debug transport (network-accessible debug bridge) — deferred to post-1.0 (Appendix E)
- Debug overlay rendered inside the game canvas — separate renderer feature
- Persisting ring buffer to disk between sessions — M7 only covers in-memory buffer

## Child tasks

<!-- Populated after feature issue is created. List task issue numbers here. -->

- [ ] #<!-- T1 -->
- [ ] #<!-- T2 -->
- [ ] #<!-- T3 -->
- [ ] #<!-- T4 -->
- [ ] #<!-- T5 -->
- [ ] #<!-- T6 -->
- [ ] #<!-- T7 -->
- [ ] #<!-- T8 -->
- [ ] #<!-- T9 -->
- [ ] #<!-- T10 -->
- [ ] #<!-- T11 -->
- [ ] #<!-- T12 -->

## Acceptance Criteria

- [ ] All child task issues closed
- [ ] §12 M7 checklist items for debug layer are green (`SnapshotRingBuffer`, `SnapshotInspector`, `SnapshotDiff`, `DebugProtocol` implemented; `debug-bridge.ts` and `debug-api.ts` wired; Inspector Window launches when `CHIMERA_DEBUG=1`; all 6 panels functional; Projection Explorer correct; production build clean; ring buffer security test passing)
- [ ] Module boundary invariants upheld: `simulation/debug/` imports nothing from `renderer/`, `electron/`, or `games/*`
- [ ] `IS_DEBUG_MODE=false` verified in production build: `window.__chimeraDebug` is `undefined` in the game renderer window
- [ ] Ring buffer security test passing: `chimera:debug` IPC handler rejects requests from any `webContents.id` that is not the Inspector Window
- [ ] Projection Explorer side-by-side diff shows correct full-snapshot vs. projected-snapshot for every `PlayerId` at any selected tick

## Invariants

- Invariant 1: `GameSnapshot` is sent to the Inspector Window in debug mode only; the game renderer window never receives `GameSnapshot` through any path
- Invariant 2: `simulation/debug/` has zero imports from `renderer/`, `electron/`, `games/*`, or any DOM API
