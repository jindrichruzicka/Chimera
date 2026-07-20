// simulation/bridge/debug-api-types.ts
//
// Type-only module declaring the full `window.__chimeraDebug` contract
// (`ChimeraDebugApi`). Lives in the `@chimera-engine/simulation` leaf (the neutral home
// both renderer and electron/preload import — sibling of `api-types.ts`). This is
// the Invariant 28 counterpart of `api-types.ts`: the Debug Inspector surface is
// typed HERE and nowhere else; `api-types.ts` must never declare it, and the runtime
// exposure lives solely in `electron/preload/debug-api.ts`, attached only to the
// Inspector `BrowserWindow` (§4.12 — Runtime Debug Layer).
//
// Everything is `import type`/`export type`, so the renderer debug page
// consumes this module — via `renderer/types/chimera-debug.d.ts`
// — with zero runtime coupling to `simulation/debug` (Invariant #27: nothing
// here can pull the debug module graph into a renderer runtime).
//
// Snapshot-carrying payloads are derived from `DebugResponse` variants with
// `Extract`/`Omit` instead of naming the simulation snapshot type directly:
// invariant check 6 forbids that identifier anywhere under
// `electron/preload/` and `renderer/` (Invariant #3 — full truth is debug
// only, and only on this surface).

import type {
    DebugRequest,
    DebugResponse,
    NetworkDiagnostics,
    PerfStats,
    TickDurationSample,
    TickEntry,
} from '../debug/DebugProtocol.js';
import type { DiffEntry, SnapshotDiff } from '../debug/SnapshotDiff.js';
import type { ActionHistoryEntry } from '../engine/UndoManager.js';
import type { PlayerId } from '../engine/types.js';
import type { PlayerSnapshot } from '../projection/StateProjector.js';
import type { Unsubscribe } from './api-types.js';

// Single import root for the Inspector page: every protocol type it needs is
// re-exported here so the page never reaches into `simulation/` directly.
export type {
    ActionHistoryEntry,
    DebugRequest,
    DebugResponse,
    DiffEntry,
    NetworkDiagnostics,
    PerfStats,
    PlayerId,
    PlayerSnapshot,
    SnapshotDiff,
    TickDurationSample,
    TickEntry,
    Unsubscribe,
};

/** Resolved full-truth snapshot at a tick: `{ tick, snapshot }`. */
export type SnapshotResult = Omit<Extract<DebugResponse, { type: 'SNAPSHOT' }>, 'type'>;

/** Player-visible projection at a tick: `{ tick, playerId, snapshot }`. */
export type ProjectionResult = Omit<Extract<DebugResponse, { type: 'PROJECTION' }>, 'type'>;

/** One live push delivered to {@link ChimeraDebugApi.onLiveTick}: `{ tick, snapshot }`. */
export type LiveTickEvent = Omit<Extract<DebugResponse, { type: 'LIVE_TICK' }>, 'type'>;

/**
 * The `window.__chimeraDebug` bridge surface — one method per
 * `DebugRequest` variant plus the {@link onLiveTick} push subscription.
 * Query method names mirror the `SnapshotInspector` facade they resolve to
 * on the main side (§4.12).
 *
 * Every request travels over the `chimera:debug` invoke channel; the bridge
 * never throws, so failures surface as `{ type: 'ERROR' }` responses which
 * the preload converts into promise rejections.
 */
export interface ChimeraDebugApi {
    /** Diff View tick pickers: union of action-log ticks and buffered ticks, ascending. */
    listTicks(): Promise<readonly TickEntry[]>;
    /** Full authoritative snapshot at `tick` ("full truth — debug only"). */
    getSnapshot(tick: number): Promise<SnapshotResult>;
    /** What `playerId` would see at `tick` — projected via StateProjector. */
    getProjection(tick: number, playerId: PlayerId): Promise<ProjectionResult>;
    /** Structural diff between two resolved ticks. */
    diff(fromTick: number, toTick: number): Promise<SnapshotDiff>;
    /** Action-log entries with `tickApplied` within the inclusive bounds. */
    getActionLog(fromTick?: number, toTick?: number): Promise<readonly ActionHistoryEntry[]>;
    /** Aggregates for the Performance panel. */
    getPerfStats(): Promise<PerfStats>;
    /**
     * Connection diagnostics for the NAT / port-forward guidance: non-internal
     * IPv4 addresses and the active hosted port. Resolves at the bridge level,
     * so it works while hosting in the lobby before any game is running.
     */
    getNetworkDiagnostics(): Promise<NetworkDiagnostics>;
    /** Start live-tick pushes for this window (`SUBSCRIBE_LIVE` → `ACK`). */
    subscribeLive(): Promise<void>;
    /** Stop live-tick pushes for this window (`UNSUBSCRIBE_LIVE` → `ACK`). */
    unsubscribeLive(): Promise<void>;
    /**
     * Listen for `LIVE_TICK` pushes on `chimera:debug:push`. Delivery also
     * requires an active {@link subscribeLive} registration on the main
     * side. Returns an {@link Unsubscribe} removing exactly this listener.
     */
    onLiveTick(cb: (event: LiveTickEvent) => void): Unsubscribe;
}
