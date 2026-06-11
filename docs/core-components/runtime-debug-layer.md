---
title: 'Runtime Debug Layer'
description: 'IS_DEBUG_MODE constant, Inspector Window separation, SnapshotRingBuffer (capacity=200), SnapshotInspector (6 query methods), SnapshotDiff, DebugProtocol, debug-bridge.ts, and the 6 Inspector UI panels.'
tags: [debug, inspector, ring-buffer, snapshot-diff, development-only]
---

# Runtime Debug Layer

> §4.12 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [State Projection](state-projection-interfaces.md)

---

## Overview

The debug layer gives developers full, authoritative visibility into the running simulation: every historical `GameSnapshot`, every action ever applied, and a per-player projection explorer showing exactly what each player's `PlayerSnapshot` looks like at any tick. It is **entirely absent in production** and must never create an information exposure risk for players.

---

## Debug Mode Identification

```typescript
// shared/constants.ts
// IS_DEBUG_MODE is replaced at build time; debug module graph is tree-shaken in production
export const IS_DEBUG_MODE =
    process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';
```

| Environment           | `CHIMERA_DEBUG` | `IS_DEBUG_MODE` | Debug bridge started |
| --------------------- | --------------- | --------------- | -------------------- |
| Production package    | absent          | `false`         | Never                |
| Dev server            | `1`             | `true`          | Yes                  |
| CI (unit/integration) | absent          | `false`         | Never                |
| E2E tests             | absent          | `false`         | Never                |

Dynamic import gate in `electron/main/index.ts`:

```typescript
if (IS_DEBUG_MODE) {
    const { startDebugBridge } = await import('./debug-bridge');
    await startDebugBridge(simulationHost, stateProjector);
}
```

> **Invariant #27** — `CHIMERA_DEBUG` must never appear in production packaging. The production build asserts `IS_DEBUG_MODE === false` at startup.

---

## Inspector Window Separation

The Inspector Window is a **second, independent `BrowserWindow`** with its own preload (`debug-api.ts`) exposing `window.__chimeraDebug`. The game renderer's `window.__chimera` is unreachable from the Inspector Window.

```
Host Machine (CHIMERA_DEBUG=1)
│
├── Game Renderer Window
│     preload: api.ts → window.__chimera        ← game controls, snapshots
│     NO access to __chimeraDebug
│
└── Inspector Window (second BrowserWindow)
      preload: debug-api.ts → window.__chimeraDebug
      NO access to window.__chimera
```

> **Invariant #28** — `window.__chimeraDebug` is exposed only by `debug-api.ts` and only to the Inspector Window.
> **Invariant #29** — `chimera:debug` ipcMain handler validates `event.sender.id` against Inspector Window's `webContents.id` on every request.

---

## SnapshotRingBuffer

```typescript
// simulation/debug/SnapshotRingBuffer.ts

export class SnapshotRingBuffer {
    // Default capacity: 200 ticks (~10s at 20Hz)
    constructor(private readonly capacity: number = 200) {}

    record(tick: number, snapshot: GameSnapshot): void; // called between pipeline steps 5 and 7
    get(tick: number): RingBufferEntry | undefined;
    allTicks(): number[]; // sorted newest first
    onRecord?: (entry: RingBufferEntry) => void; // live-push hook for debug-bridge
}
```

> **Invariant #30** — `SnapshotRingBuffer` has a fixed capacity; it must never grow unboundedly.
> **Invariant #31** — `SnapshotInspector` and `SnapshotRingBuffer` are instantiated only when `IS_DEBUG_MODE` is true.

---

## SnapshotInspector

```typescript
// simulation/debug/SnapshotInspector.ts

export class SnapshotInspector {
    listTicks(): TickEntry[]; // full action history
    getSnapshot(tick: number): GameSnapshot; // O(1) from ring buffer; O(n) replay otherwise
    getProjection(tick: number, playerId: PlayerId): PlayerSnapshot; // what a player would see
    diff(fromTick: number, toTick: number): SnapshotDiff; // structural diff
    getActionLog(fromTick?: number, toTick?: number): ActionHistoryEntry[];
    getPerfStats(): PerfStats; // avg/max tick duration
}
```

`reconstructFromMemento(tick)` replays actions from the nearest `TurnMemento` when a tick is not in the ring buffer. Bounded by turn length (typically < 50 actions).

---

## SnapshotDiff

```typescript
// simulation/debug/SnapshotDiff.ts

export interface DiffEntry {
    path: string; // Dot-delimited JSON path: 'entities.unit-1.hp'
    kind: 'added' | 'removed' | 'changed';
    before?: unknown;
    after?: unknown;
}

export interface SnapshotDiff {
    fromTick: number;
    toTick: number;
    entries: DiffEntry[];
    summary: { added: number; removed: number; changed: number };
}
```

---

## DebugProtocol — Typed IPC Messages

```typescript
// simulation/debug/DebugProtocol.ts

// Inspector Window → Main (requests)
export type DebugRequest =
    | { type: 'GET_TICK_LIST' }
    | { type: 'GET_SNAPSHOT'; tick: number }
    | { type: 'GET_PROJECTION'; tick: number; playerId: PlayerId }
    | { type: 'GET_DIFF'; fromTick: number; toTick: number }
    | { type: 'GET_ACTION_LOG'; fromTick?: number; toTick?: number }
    | { type: 'GET_PERF_STATS' }
    | { type: 'SUBSCRIBE_LIVE' }
    | { type: 'UNSUBSCRIBE_LIVE' };

// Main → Inspector Window (responses + live pushes)
export type DebugResponse =
    | { type: 'TICK_LIST'; ticks: TickEntry[] }
    | { type: 'SNAPSHOT'; tick: number; snapshot: GameSnapshot } // full truth — debug only
    | { type: 'PROJECTION'; tick: number; playerId: PlayerId; snapshot: PlayerSnapshot }
    | { type: 'DIFF'; diff: SnapshotDiff }
    | { type: 'ACTION_LOG'; entries: ActionHistoryEntry[] }
    | { type: 'PERF_STATS'; stats: PerfStats }
    | { type: 'LIVE_TICK'; tick: number; snapshot: GameSnapshot }
    | { type: 'ERROR'; message: string };
```

---

## ActionPipeline Hook

The only simulation-side coupling is a single optional callback in `PipelineContext`, called between stage 5 (reduce) and stage 7 (broadcast):

```typescript
// Inside ActionPipeline.process():
context.debugObserver?.(nextState.tick, nextState);
```

`debugObserver` is `undefined` in production — zero overhead.

The stage-3 undo/redo intercept (which short-circuits stages 4–5) fires the same callback with the reconstructed state, so the Inspector timeline sees undo/redo transitions and the ring buffer never holds a stale entry for a reconstructed tick.

The observer fires once per `process()` invocation, outer and nested dispatches alike, so consumers (e.g. a `LIVE_TICK` push from `onRecord`) may receive several intermediate states for the same tick; the final same-tick record supersedes the intermediates via the ring buffer's in-place replacement.

**Observer contract:** the pipeline invokes the callback unguarded — exactly the call shape above — so the observer must never throw. A thrown error would abort the in-flight authoritative action, and on the stage-3 intercept path also skip the undo/redo history append. The debug bridge therefore catches all errors inside its observer and reports failures over its own channel instead of letting them propagate into the pipeline.

---

## Inspector Window UI Panels

| Panel                   | Description                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------- |
| **Timeline**            | Scrollable tick list; ring-buffered ticks highlighted (O(1)). Live mode auto-scrolls. |
| **Snapshot Inspector**  | JSON tree of full `GameSnapshot` at selected tick — no projection applied.            |
| **Projection Explorer** | PlayerId dropdown + side-by-side diff of full vs. projected snapshot per player.      |
| **Diff View**           | Compare any two ticks; flat list of changed paths with before/after values.           |
| **Action Log**          | Filterable table of `ActionHistoryEntry` rows; filter by playerId, type, tick range.  |
| **Performance**         | Tick duration graph, avg/max tick time, ring buffer fill level, total action count.   |

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `PipelineContext.debugObserver`
- [State Projection](state-projection-interfaces.md) — `StateProjector.project()` used in Projection Explorer
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — Invariants #27–31
