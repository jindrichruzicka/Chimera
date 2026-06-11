/**
 * simulation/debug/DebugProtocol.ts
 *
 * Typed request/response message shapes for the debug IPC channel between
 * the Inspector Window and the main-process debug bridge (§4.12 — Runtime
 * Debug Layer).
 *
 * This module is type-only: it has no runtime exports, so `electron/` and
 * the Inspector preload consume it exclusively via `import type` with zero
 * runtime coupling to `simulation/` (Invariant #31 — the debug layer is
 * instantiated only when `IS_DEBUG_MODE` is true; this module never reads
 * environment state).
 *
 * All payloads are JSON-plain (no Map/Date/class instances) so they survive
 * Electron's structured-clone IPC unchanged.
 */

import type { BaseGameSnapshot, PlayerId } from '../engine/types.js';
import type { ActionHistoryEntry } from '../engine/UndoManager.js';
import type { PlayerSnapshot } from '../projection/StateProjector.js';
import type { SnapshotDiff } from './SnapshotDiff.js';

// ─── Inspector data shapes ────────────────────────────────────────────────────

/**
 * One row of the Inspector Timeline panel.
 *
 * Action metadata fields are present only when the tick is backed by an
 * action-log entry (`ActionHistoryEntry.tickApplied === tick`); ticks known
 * only from the ring buffer (log pruned, nested-dispatch intermediates) omit
 * them entirely — absent, not `undefined` — matching the JSON-serialization
 * convention used by `SnapshotDiff`.
 */
export interface TickEntry {
    readonly tick: number;
    /**
     * True when the snapshot for this tick is resident in the ring buffer
     * (O(1) retrieval; highlighted in the Timeline panel).
     */
    readonly inRingBuffer: boolean;
    /** Type of the action that entered the pipeline at this tick. */
    readonly actionType?: string;
    /** Issuer of that action, when known from the action log. */
    readonly playerId?: PlayerId;
    /** Turn during which that action was applied, when known from the log. */
    readonly turnNumber?: number;
}

/** One point on the Performance panel's tick-duration graph. */
export interface TickDurationSample {
    readonly tick: number;
    readonly durationMs: number;
}

/**
 * Aggregates for the Performance panel: tick-duration graph, avg/max tick
 * time, ring buffer fill level, and total action count.
 *
 * Durations are measured by the debug bridge in `electron/main` (wall-clock
 * APIs are forbidden inside `simulation/`, Invariant #43) and pushed into
 * the inspector via `SnapshotInspector.recordTickDuration()`.
 */
export interface PerfStats {
    /** Mean over all samples ever recorded; 0 when none. */
    readonly avgTickDurationMs: number;
    /** Max over all samples ever recorded; 0 when none. */
    readonly maxTickDurationMs: number;
    /** Total number of duration samples ever recorded. */
    readonly sampleCount: number;
    /** Bounded recent window for the graph, oldest first (Invariant #30 spirit). */
    readonly recentSamples: readonly TickDurationSample[];
    /** Ring buffer occupancy: `used` = currently buffered ticks. */
    readonly ringBufferFill: { readonly used: number; readonly capacity: number };
    /** Current number of entries in the action log. */
    readonly totalActionCount: number;
}

// ─── IPC message unions ───────────────────────────────────────────────────────

/** Inspector Window → Main (requests). */
export type DebugRequest =
    | { readonly type: 'GET_TICK_LIST' }
    | { readonly type: 'GET_SNAPSHOT'; readonly tick: number }
    | { readonly type: 'GET_PROJECTION'; readonly tick: number; readonly playerId: PlayerId }
    | { readonly type: 'GET_DIFF'; readonly fromTick: number; readonly toTick: number }
    | { readonly type: 'GET_ACTION_LOG'; readonly fromTick?: number; readonly toTick?: number }
    | { readonly type: 'GET_PERF_STATS' }
    | { readonly type: 'SUBSCRIBE_LIVE' }
    | { readonly type: 'UNSUBSCRIBE_LIVE' };

/** Main → Inspector Window (responses + live pushes). */
export type DebugResponse<TState extends BaseGameSnapshot = BaseGameSnapshot> =
    | { readonly type: 'TICK_LIST'; readonly ticks: readonly TickEntry[] }
    // Full unprojected truth — debug only, never reaches a game renderer.
    | { readonly type: 'SNAPSHOT'; readonly tick: number; readonly snapshot: Readonly<TState> }
    | {
          readonly type: 'PROJECTION';
          readonly tick: number;
          readonly playerId: PlayerId;
          readonly snapshot: PlayerSnapshot;
      }
    | { readonly type: 'DIFF'; readonly diff: SnapshotDiff }
    | { readonly type: 'ACTION_LOG'; readonly entries: readonly ActionHistoryEntry[] }
    | { readonly type: 'PERF_STATS'; readonly stats: PerfStats }
    | { readonly type: 'LIVE_TICK'; readonly tick: number; readonly snapshot: Readonly<TState> }
    | { readonly type: 'ERROR'; readonly message: string }
    // Data-free acknowledgement for SUBSCRIBE_LIVE / UNSUBSCRIBE_LIVE.
    | { readonly type: 'ACK' };
