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

The debug layer gives developers full, authoritative visibility into the running simulation: every historical `GameSnapshot`, every action ever applied, and a per-player projection explorer showing exactly what each player's `PlayerSnapshot` looks like at any tick. It is **never reachable in production** and must never create an information exposure risk for players: a packaged build bakes `IS_DEBUG_MODE` to the literal `false`, and the startup guard refuses to start a packaged binary carrying `CHIMERA_DEBUG` (Invariant #27). Beyond being unreachable, the layer is **absent** from a distributable — the main-process graph, the Inspector preload, and the Inspector UI route are all left out of a packaged build (see [Exclusion from packaged builds](#exclusion-from-packaged-builds)).

---

## Debug Mode Identification

```typescript
// simulation/foundation/constants.ts
// Both reads are replaced at build time in a packaged build, folding this to `false`
export const IS_DEBUG_MODE =
    process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';
```

In a **packaged** build the app bundler bakes both reads (`process.env.NODE_ENV = "production"` and `process.env.CHIMERA_DEBUG = ""`) as esbuild `define`s, so the emitted `dist/electron/main.js` contains the literal `IS_DEBUG_MODE = false`. The same two defines fold the gate's inlined copy of that expression — which is what the debug bridge actually sits behind (see the note below) — leaving it permanently false: even if the startup guard were bypassed, no debug surface can be registered. That define is opt-in — the packaging scripts declare `CHIMERA_PACKAGED_BUILD=1` (`computePackagedDefine` in the app's `build-main.ts`). `build:app` is the same script an everyday dev launch runs, so packaging cannot be inferred; a dev or e2e build deliberately gets no define, keeping F9 reachable.

Both reads must be defined: replacing only `NODE_ENV` leaves `process.env.CHIMERA_DEBUG === '1' && false`, which esbuild cannot reduce to a literal.

> **The gate does not test `IS_DEBUG_MODE`.** It inlines the same expression instead. esbuild does not propagate a cross-module constant into a consuming module, so written as `if (IS_DEBUG_MODE)` the branch stayed live and the whole debug graph shipped. Written out, the define folds it to `if (false)` and the dynamic-import records are pruned with it. That duplication is deliberate and is pinned by `tools/packaged-build-flag.test.ts` — drift between the two copies silently restores the shipped graph.

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

Dynamic import gate in `electron/main/index.ts` — the two dot-access reads let the bundler's `define` replacement fold the condition to `false`, so the branch is never entered in a packaged build and the modules behind it are never bundled:

```typescript
let debugBridge: DebugBridge | undefined = undefined;
if (process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production') {
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

## Exclusion from packaged builds

The runtime controls above make the layer unreachable. Three separate exclusions additionally strip it out of the **Electron** side of the build output. All three key off the same declared packaging signal, `CHIMERA_PACKAGED_BUILD=1` / `NEXT_PUBLIC_CHIMERA_PACKAGED=1` — a dev or e2e build sets neither and is unaffected, which is what keeps F9 working.

| What                                                                                                                          | How it is excluded                                              | Effect                                                                         | Kept honest by                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main-process graph (`debug-bridge`, `SnapshotInspector`, `SnapshotRingBuffer`, `SnapshotDiff`, the `chimera:debug*` handlers) | The folded gate prunes both dynamic imports                     | `dist/electron/main.js` loses ~30 KB                                           | **Gate** — `pnpm verify:packaged-bundle` (each run also requires a dev build to be rejected by every predicate, so a rotted check fails the gate itself; runs in CI and in the merge script's pre-merge gate), plus the in-memory `packaged-bundle-content.test.ts` |
| Inspector preload                                                                                                             | `buildAppBundles` plans no `debug-preload` spec                 | `dist/preload/debug-api.js` (532 KB) + its 1.06 MB sourcemap no longer emitted | **Test** — the same file, plus `build-main.test.ts`                                                                                                                                                                                                                 |
| Inspector UI route                                                                                                            | `debugRouteGate` → `notFound()` in the route's server component | `/debug/index.html` is the 404 page, with no Inspector markup                  | **Observation only** — no build-output assertion (see below)                                                                                                                                                                                                        |

**Only the first row shrinks the distributable.** `apps/tactics/electron-builder.yml` ships an explicit `files` allowlist — `dist/electron/main.js`, `dist/preload/api.js`, `renderer/out` minus `**/*.map`, and the asset dirs — so `dist/preload/debug-api.js` and every `.map` were already outside the packaged app, by construction, before this change. The shipped-byte reduction is the main-bundle delta alone: **roughly 30 KB**.

That figure is deliberately approximate. Absolute bundle totals move with engine-dist churn and with the working directory the build ran in — esbuild embeds cwd-relative module paths — so a pinned byte count goes stale on changes that have nothing to do with this property, and then reads as a regression to whoever re-measures. The checkable claim is the ABSENCE of the debug markers, which `pnpm verify:packaged-bundle` asserts against the bytes a real packaging run emits.

That does not make the second row idle. `files` in a scaffolded game's `electron-builder.yml` is adopter-editable, and widening it to `dist/**` is an entirely natural edit — at which point an _emitted_ debug preload would ship. "Not built" is a stronger guarantee than "not listed", and it keeps 1.59 MB of debug code out of the build tree either way. It is just not a saving in the distributable. That edit is no longer merely warned about: every consumer app's `verify:packaged-bundle` gate — the scaffolded game's included — checks the `files:` allowlist alongside the emitted bytes and **fails** on a `dist/` glob, a listed debug preload, or a dropped shipped-bundle entry (see [the engine-exported guard](#the-engine-exported-guard-scaffolded-games) below).

The last column matters. The first two rows are asserted against a real esbuild run, so a regression fails CI. The third was measured once by hand: nothing inspects the exported `out/` tree, exactly as for the Component Gallery gate whose shape it copies. Its unit tests cover `notFound()` being called, not what `next build` then emits — so treat the 404 as verified-at-the-time, not ratcheted.

> **The route gate does not remove the panel JavaScript.** Next still emits `_next/static/chunks/app/debug/page-*.js` in a packaged export — the gate replaces the prerendered page with a 404, so nothing ever loads that chunk, but it is on disk. This matches the Component Gallery gate exactly; it is the established behaviour of this pattern, not a gap specific to `/debug`. The Electron-side exclusions above are what actually remove code from the distributable.

Two further things this deliberately does **not** do:

- It does not remove `simulation/debug/*` from the source tree. That module is a public `./debug` subpath, and `DebugProtocol` / `SnapshotDiff` have type-only importers reaching the renderer — type-only, so they cost zero runtime bytes. Absence from the _bundle_ is the goal, not deletion.
- It does not minify, so the dead `if (false) { … }` statements survive in the packaged main bundle with their imports rewritten to `await null`. They reference `startDebugBridge` by name while reaching no module — which is why the bundle-content assertion in `apps/tactics/electron/__tests__/packaged-bundle-content.test.ts` keys off graph-internal names instead.

That assertion is the enforcement: it runs a real esbuild over the production bundle plan and fails if any marker reappears, with an inverted dev-build case so it cannot pass vacuously.

### The engine-exported guard (scaffolded games)

The marker set and the verification logic live in **one place**: the public `@chimera-engine/electron/packaged-bundle` export (`electron/packaged-bundle/`). The debug graph the markers describe is engine code, so the strings that prove its absence are engine internals — a copy in a consumer app would drift silently, and only in the weaker direction (the stale copy stops naming a module and its checks keep passing). `tools/verify-packaged-bundle.test.ts` ratchets the single-definition property repo-wide, and `verify:pack` proves the subpath resolves from the packed artifact.

The export provides the markers, the content predicates, the `electron-builder.yml` `files:`-allowlist checks, and a `verifyPackagedBundle` runner with the negative controls built in: on **every** run, the dev rebuild that restores the app's `dist/` must be rejected by **every** predicate (per predicate, not merely "some failure"), and a synthetic widened allowlist must be rejected by every allowlist check — so a gutted or rotted check fails the gate itself, on the same run.

Two thin, app-owned drivers consume it, each pointing the runner at its own app's bundle plan (`appBundleOutfiles`) and real `build:app` invocation:

- `tools/verify-packaged-bundle.ts` — the monorepo's gate (CI + the merge script's pre-merge gate, pinned by `ci-workflow.test.ts` / `merge-gate.test.ts`).
- `templates/blank/electron/verify-packaged-bundle.ts` — shipped in every scaffolded game as `pnpm verify:packaged-bundle`, because a scaffolded game's `build-main.ts` and `electron-builder.yml` are adopter-editable: dropping the packaging `define` or widening `files:` to `dist/**` would otherwise reship the debug layer with no red check anywhere. `verify:scaffold` runs the generated app's gate (the `packaged-bundle` step), so a broken template guard fails the engine's own CI (`e2e.yml`, pinned by `e2e-workflow.test.ts`) rather than a downstream adopter's packaging run.

The engine package imports nothing from `tools/` or any app (§3 dependency direction): the drivers own the paths and build commands, the engine owns the checks.

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
