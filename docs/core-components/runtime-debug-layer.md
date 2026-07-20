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

The debug layer gives developers full, authoritative visibility into the running simulation: every historical `GameSnapshot`, every action ever applied, and a per-player projection explorer showing exactly what each player's `PlayerSnapshot` looks like at any tick. It is **never reachable in production** and must never create an information exposure risk for players: a packaged build bakes `IS_DEBUG_MODE` to the literal `false`, and the startup guard refuses to start a packaged binary carrying `CHIMERA_DEBUG` (Invariant #27). The debug code is still _present_ in the shipped bundle — see the tree-shaking note below.

---

## Debug Mode Identification

```typescript
// simulation/foundation/constants.ts
// Both reads are replaced at build time in a packaged build, folding this to `false`
export const IS_DEBUG_MODE =
    process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';
```

In a **packaged** build the app bundler bakes both reads (`process.env.NODE_ENV = "production"` and `process.env.CHIMERA_DEBUG = ""`) as esbuild `define`s, so the emitted `dist/electron/main.js` contains the literal `IS_DEBUG_MODE = false`. The debug bridge then sits behind a permanently-false gate: even if the startup guard were bypassed, no debug surface can be registered. That define is opt-in — the packaging scripts declare `CHIMERA_PACKAGED_BUILD=1` (`computePackagedDefine` in the app's `build-main.ts`). `build:app` is the same script an everyday dev launch runs, so packaging cannot be inferred; a dev or e2e build deliberately gets no define, keeping F9 reachable.

Both reads must be defined: replacing only `NODE_ENV` leaves `process.env.CHIMERA_DEBUG === '1' && false`, which esbuild cannot reduce to a literal.

> **Not tree-shaking.** The debug module graph still ships in the packaged bundle. `IS_DEBUG_MODE` is imported across a module boundary (the built `@chimera-engine/simulation` dist), so esbuild does not propagate the literal into `if (IS_DEBUG_MODE)` and cannot drop the branch or its dynamic import. The gate is dead at runtime, but the code is present — eliminating it is a separate, unsolved concern.

| Environment           | `CHIMERA_DEBUG` | `IS_DEBUG_MODE` | Debug bridge started |
| --------------------- | --------------- | --------------- | -------------------- |
| Production package    | absent          | `false`         | Never                |
| Production package    | `1`             | `false`         | **Refuses to start** |
| Dev server            | `1`             | `true`          | Yes                  |
| Undefined build, pkgd | `1`             | `true`          | **Refuses to start** |
| CI (unit/integration) | absent          | `false`         | Never                |
| E2E tests             | absent          | `false`         | Never                |

A packaged binary carrying `CHIMERA_DEBUG` does not silently drop to a debug-free boot — it refuses to start (Invariant #27). electron-builder never sets `NODE_ENV`, so the guard trusts `app.isPackaged`, not the environment.

The two refusal rows are the two independent layers, and it matters which one fires. The refusal is driven by the **`CHIMERA_DEBUG` environment read**, never by `IS_DEBUG_MODE` — so it fires even in a correctly-defined bundle where `IS_DEBUG_MODE` is already the baked literal `false`. The "undefined build" row is the belt-and-braces case: a packaging script that lost `CHIMERA_PACKAGED_BUILD=1` emits a bundle whose gate is still live (`IS_DEBUG_MODE` is `true` under `CHIMERA_DEBUG=1`), and the runtime guard is the only thing standing between that binary and the Inspector. It still refuses. The drift test in `tools/packaged-build-flag.test.ts` exists so that row stays hypothetical.

Dynamic import gate in `electron/main/index.ts` — the dot-access constant lets the bundler's `define` replacement fold `IS_DEBUG_MODE` to `false`, so the branch is never entered in a packaged build:

```typescript
let debugBridge: DebugBridge | undefined = undefined;
if (IS_DEBUG_MODE) {
    const { startDebugBridge } = await import('./debug-bridge.js');
    debugBridge = startDebugBridge({ ipcMain, logger, debugPreloadPath });
}

// Later, once per hosted session (getters are lazy — projector and replay
// are declared after the attach inside the session wiring closure):
const debugPort = debugBridge?.attachSession({
    getProjector: () => projector,
    getReplay: () => replay,
});
// debugPort (HostSessionDebugPort) feeds buildHostSessionPipeline, which
// wires its observer into PipelineContext.debugObserver. Outside debug mode
// debugPort is undefined and the pipeline context carries no debugObserver.
```

`startDebugBridge` registers the IPC surface immediately but creates **no** Inspector window — the window is lazily created on the first `chimera:debug:toggle-inspector` send and closed on the next. `attachSession` resets the ring buffer, inspector, action log, and mementos for each freshly hosted session (live subscribers and the window survive re-attach).

The toggle is driven by the `engine:toggle-debug-inspector` InputAction (default **F9**, rebindable — see [Input & Keybindings](input-keybindings.md)): the game renderer dispatches it through `window.__chimera.system.toggleDebugInspector()`, a fire-and-forget, payload-less send on `chimera:debug:toggle-inspector`. In production builds no listener is registered on the channel, so the send is a true no-op.

> **Invariant #27** — `CHIMERA_DEBUG` must never appear in production packaging. A production runtime (packaged **or** `NODE_ENV=production`) asserts `IS_DEBUG_MODE === false` at startup and refuses to start when `CHIMERA_DEBUG` is set — see `isProductionRuntime` / `assertProductionDebugGuard` in `electron/main/startup-guard.ts`.

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

The Inspector Window is **closed by default**: it does not exist at bridge startup, is created on the first F9 toggle, and is destroyed on the next. The debug bridge and its IPC surface run from startup; the ring buffer is instantiated per attached session (`attachSession`, Invariant #31) and records whether or not the window exists.

> **Invariant #28** — `window.__chimeraDebug` is exposed only by `debug-api.ts` and only to the Inspector Window. The game preload exposes no debug **data** surface; its data-free Inspector-window toggle is explicitly permitted.
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
    | { type: 'ERROR'; message: string }
    | { type: 'ACK' }; // data-free acknowledgement for SUBSCRIBE_LIVE / UNSUBSCRIBE_LIVE
```

### IPC channels

Channel constants are plain strings in `simulation/foundation/constants.ts` so the Inspector preload mirrors them without importing the debug module graph (Invariant #27). In production no handler or listener exists on any of them — renderer sends are true no-ops.

| Constant                         | Channel                          | Direction                 | Payload                                                             |
| -------------------------------- | -------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `DEBUG_CHANNEL`                  | `chimera:debug`                  | Inspector → Main (invoke) | `DebugRequest` → `DebugResponse`; sender validated (Invariant #29)  |
| `DEBUG_TOGGLE_INSPECTOR_CHANNEL` | `chimera:debug:toggle-inspector` | Renderer → Main (send)    | none — lazily creates the Inspector window / closes it on re-toggle |
| `DEBUG_PUSH_CHANNEL`             | `chimera:debug:push`             | Main → Inspector (send)   | `LIVE_TICK` responses for `SUBSCRIBE_LIVE` subscribers              |

---

## ActionPipeline Hook

The only simulation-side coupling is a single optional callback in `PipelineContext`, called between stage 5 (reduce) and stage 7 (broadcast):

```typescript
// Inside ActionPipeline.process():
context.debugObserver?.(nextState.tick, nextState);
```

`debugObserver` is `undefined` in production — zero overhead.

The stage-3 undo/redo intercept (which short-circuits stages 4–5) fires the same callback with the reconstructed state, so the Inspector sees undo/redo transitions and the ring buffer never holds a stale entry for a reconstructed tick.

The observer fires once per `process()` invocation, outer and nested dispatches alike, so consumers (e.g. a `LIVE_TICK` push from `onRecord`) may receive several intermediate states for the same tick; the final same-tick record supersedes the intermediates via the ring buffer's in-place replacement.

**Observer contract:** the pipeline invokes the callback unguarded — exactly the call shape above — so the observer must never throw. A thrown error would abort the in-flight authoritative action, and on the stage-3 intercept path also skip the undo/redo history append. The debug bridge therefore catches all errors inside its observer and reports failures over its own channel instead of letting them propagate into the pipeline.

---

## Inspector Window UI Panels

| Panel           | Description                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Action Log**  | Filterable table of `ActionHistoryEntry` rows; filter by playerId, type, tick range. Default tab.                                    |
| **Snapshot**    | JSON tree of full `GameSnapshot` at the selected tick plus a playerId dropdown with the side-by-side projected view for that player. |
| **Diff View**   | Compare any two ticks; flat list of changed paths with before/after values.                                                          |
| **Performance** | Tick duration graph, avg/max tick time, ring buffer fill level, total action count. Refreshes live on pushed ticks.                  |

Tick selection is driven by the Action Log: on open it is seeded to the state produced by the newest logged action (`tickApplied + 1` — the log records pre-action ticks), and double-clicking a log row re-points the shared selection to that row's `tickApplied` and jumps to the Snapshot tab.

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `PipelineContext.debugObserver`
- [State Projection](state-projection-interfaces.md) — `StateProjector.project()` used in Projection Explorer
- [Input & Keybindings](input-keybindings.md) — `engine:toggle-debug-inspector` InputAction (default F9)
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — Invariants #27–31
