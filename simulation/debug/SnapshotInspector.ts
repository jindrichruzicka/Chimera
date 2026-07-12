/**
 * simulation/debug/SnapshotInspector.ts
 *
 * Facade: query API over the snapshot ring buffer, action history, turn
 * mementos, and state projector — get/reconstruct/diff snapshots, project to
 * a PlayerId, read the action log, and aggregate perf stats (§4.12 — Runtime
 * Debug Layer).
 *
 * Invariant #31: instantiated only when `IS_DEBUG_MODE` is true. This module
 * never reads environment state — the gate lives in `electron/main`, which
 * also wires every dependency in `SnapshotInspectorOptions`.
 * Invariant #43: no wall-clock reads here. Tick durations are measured by the
 * debug bridge in `electron/main` and pushed in via `recordTickDuration()`;
 * the injected `replay` callback is pure and deterministic (same contract as
 * `InMemoryUndoManager`'s host-supplied replay).
 * Invariant #30 (spirit): the recent-samples window is fixed-capacity and
 * never grows unboundedly.
 *
 * All queries are read-only over injected providers: snapshots, mementos,
 * and log entries are shared by reference and never cloned or mutated.
 */

import { diffSnapshots } from './SnapshotDiff.js';
import type { SnapshotDiff } from './SnapshotDiff.js';
import type { SnapshotRingBuffer } from './SnapshotRingBuffer.js';
import type { PerfStats, TickDurationSample, TickEntry } from './DebugProtocol.js';
import type { BaseGameSnapshot, PlayerId } from '../engine/types.js';
import type { ActionHistoryEntry } from '../engine/UndoManager.js';
import type { PlayerSnapshot, StateProjector } from '../projection/StateProjector.js';

/** Default bound on the recent-samples window: mirrors the ring buffer (~10 s at 20 Hz). */
export const DEFAULT_PERF_SAMPLE_CAPACITY = 200;

/**
 * Replay-base memento as the inspector needs it. `TurnMemento` from
 * `simulation/engine/UndoManager.ts` satisfies this structurally at the
 * default `TState = BaseGameSnapshot`.
 */
export interface InspectorMemento<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    /** Tick value of the snapshot when the memento was captured. */
    readonly tickAtTurnStart: number;
    /** Full authoritative snapshot at turn start — the replay base. */
    readonly snapshotAtTurnStart: Readonly<TState>;
}

/**
 * Injected dependencies. The debug bridge (`electron/main/debug-bridge.ts`)
 * wires these from the live simulation host.
 */
export interface SnapshotInspectorOptions<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly ringBuffer: SnapshotRingBuffer<TState>;
    readonly projector: StateProjector<TState>;
    /**
     * Full ordered action log (append order, oldest first). The engine's
     * `ActionHistory` exposes no full read, so the bridge keeps its own
     * bounded log and provides it here.
     *
     * Contract: the log must be a linear history — within any
     * memento-to-tick replay window, `tickApplied` values are unique and
     * monotonically increasing. On undo (§4.12 stage-3 intercept) the bridge
     * must compact its log by dropping the undone entries before new actions
     * append; stale pre-undo entries sharing a `tickApplied` with their
     * replacements would make reconstruction replay overshoot and throw
     * `TickNotAvailableError` (`reconstruction_tick_mismatch`).
     */
    readonly getActionLog: () => readonly ActionHistoryEntry[];
    /** All retained turn mementos, in any order. */
    readonly getMementos: () => readonly InspectorMemento<TState>[];
    /**
     * Host-supplied pure replay callback — applies entries onto a base state
     * (same contract as `InMemoryUndoManager`'s injected replay).
     */
    readonly replay: (
        state: Readonly<TState>,
        entries: readonly ActionHistoryEntry[],
    ) => Readonly<TState>;
    /** Bound for the recent-samples window. Defaults to {@link DEFAULT_PERF_SAMPLE_CAPACITY}. */
    readonly perfSampleCapacity?: number;
}

/**
 * Thrown by snapshot-resolving queries when a tick is neither in the ring
 * buffer nor reconstructable from a memento. The debug bridge maps it to a
 * `{ type: 'ERROR', message }` response.
 *
 * `reason` is a stable snake_case code: `invalid_tick`,
 * `no_memento_at_or_before_tick`, or `reconstruction_tick_mismatch`.
 */
export class TickNotAvailableError extends Error {
    readonly code = 'TICK_NOT_AVAILABLE' as const;
    readonly reason: string;
    readonly tick: number;

    constructor(tick: number, reason: string) {
        super(`TickNotAvailableError: ${reason} (tick ${tick})`);
        this.name = 'TickNotAvailableError';
        this.reason = reason;
        this.tick = tick;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class SnapshotInspector<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #ringBuffer: SnapshotRingBuffer<TState>;
    readonly #projector: StateProjector<TState>;
    readonly #getActionLog: () => readonly ActionHistoryEntry[];
    readonly #getMementos: () => readonly InspectorMemento<TState>[];
    readonly #replay: (
        state: Readonly<TState>,
        entries: readonly ActionHistoryEntry[],
    ) => Readonly<TState>;

    // Perf aggregates: cumulative counters (constant memory) plus a bounded
    // recent window for the Performance panel's duration graph.
    readonly #perfSampleCapacity: number;
    readonly #recentSamples: TickDurationSample[] = [];
    #sampleCount = 0;
    #durationSum = 0;
    #maxDuration = 0;

    constructor(options: SnapshotInspectorOptions<TState>) {
        const perfSampleCapacity = options.perfSampleCapacity ?? DEFAULT_PERF_SAMPLE_CAPACITY;
        if (!Number.isInteger(perfSampleCapacity) || perfSampleCapacity <= 0) {
            throw new RangeError(
                `SnapshotInspector perfSampleCapacity must be a positive integer, got ${perfSampleCapacity}`,
            );
        }
        this.#ringBuffer = options.ringBuffer;
        this.#projector = options.projector;
        this.#getActionLog = options.getActionLog;
        this.#getMementos = options.getMementos;
        this.#replay = options.replay;
        this.#perfSampleCapacity = perfSampleCapacity;
    }

    /**
     * Timeline rows: the union of action-log ticks and buffered ticks,
     * ascending. Log-backed rows carry action metadata; buffer-only rows
     * (log pruned, nested-dispatch intermediates) omit those fields.
     */
    listTicks(): TickEntry[] {
        const logByTick = new Map<number, ActionHistoryEntry>();
        for (const entry of this.#getActionLog()) {
            // Outer-dispatch ticks are unique; should a duplicate ever
            // appear, the latest entry wins (append order).
            logByTick.set(entry.tickApplied, entry);
        }
        const ticks = new Set<number>(logByTick.keys());
        for (const tick of this.#ringBuffer.allTicks()) {
            ticks.add(tick);
        }
        let earliestMementoTick: number | undefined;
        for (const memento of this.#getMementos()) {
            if (
                earliestMementoTick === undefined ||
                memento.tickAtTurnStart < earliestMementoTick
            ) {
                earliestMementoTick = memento.tickAtTurnStart;
            }
        }
        return [...ticks]
            .sort((a, b) => a - b)
            .map((tick) => {
                const logEntry = logByTick.get(tick);
                const inRingBuffer = this.#ringBuffer.get(tick) !== undefined;
                const resolvable =
                    inRingBuffer ||
                    (earliestMementoTick !== undefined && tick >= earliestMementoTick);
                return logEntry === undefined
                    ? { tick, inRingBuffer, resolvable }
                    : {
                          tick,
                          inRingBuffer,
                          resolvable,
                          actionType: logEntry.action.type,
                          playerId: logEntry.action.playerId,
                          turnNumber: logEntry.turnNumber,
                      };
            });
    }

    /**
     * Full authoritative snapshot at `tick`: O(1) from the ring buffer, or
     * reconstructed by replaying from the nearest `TurnMemento` (bounded by
     * turn length, §4.12).
     *
     * @throws {TickNotAvailableError} when the tick is invalid, precedes all
     *   mementos, or cannot be reached by outer-dispatch replay.
     */
    getSnapshot(tick: number): Readonly<TState> {
        if (!Number.isInteger(tick)) {
            throw new TickNotAvailableError(tick, 'invalid_tick');
        }
        const hit = this.#ringBuffer.get(tick);
        if (hit !== undefined) {
            return hit.snapshot;
        }
        return this.#reconstructFromMemento(tick);
    }

    /** What a player would see at `tick` — sole gate: `StateProjector.project()`. */
    getProjection(tick: number, playerId: PlayerId): PlayerSnapshot {
        return this.#projector.project(this.getSnapshot(tick), playerId);
    }

    /** Structural diff between two resolved ticks (delegates to `diffSnapshots`). */
    diff(fromTick: number, toTick: number): SnapshotDiff {
        return diffSnapshots(this.getSnapshot(fromTick), this.getSnapshot(toTick));
    }

    /**
     * Action-log entries with `tickApplied` within the inclusive bounds;
     * omitted bounds are open. Entries are shared by reference.
     */
    getActionLog(fromTick?: number, toTick?: number): ActionHistoryEntry[] {
        return this.#getActionLog().filter(
            (entry) =>
                (fromTick === undefined || entry.tickApplied >= fromTick) &&
                (toTick === undefined || entry.tickApplied <= toTick),
        );
    }

    /**
     * Ingests one tick-duration sample measured by the debug bridge
     * (wall-clock reads are forbidden in simulation/, Invariant #43).
     */
    recordTickDuration(tick: number, durationMs: number): void {
        if (!Number.isInteger(tick)) {
            throw new RangeError(`recordTickDuration tick must be an integer, got ${tick}`);
        }
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            throw new RangeError(
                `recordTickDuration durationMs must be a finite non-negative number, got ${durationMs}`,
            );
        }
        this.#sampleCount += 1;
        this.#durationSum += durationMs;
        this.#maxDuration = Math.max(this.#maxDuration, durationMs);
        this.#recentSamples.push({ tick, durationMs });
        if (this.#recentSamples.length > this.#perfSampleCapacity) {
            this.#recentSamples.shift();
        }
    }

    /** Aggregates for the Performance panel. Avg/max cover all samples ever recorded. */
    getPerfStats(): PerfStats {
        return {
            avgTickDurationMs: this.#sampleCount === 0 ? 0 : this.#durationSum / this.#sampleCount,
            maxTickDurationMs: this.#maxDuration,
            sampleCount: this.#sampleCount,
            recentSamples: [...this.#recentSamples],
            ringBufferFill: {
                used: this.#ringBuffer.allTicks().length,
                capacity: this.#ringBuffer.capacity,
            },
            totalActionCount: this.#getActionLog().length,
        };
    }

    /**
     * Replays from the nearest memento at-or-before `tick`: entries with
     * `tickApplied` in `[memento.tickAtTurnStart, tick)` applied onto the
     * memento snapshot land exactly on `tick` (history records the pre-action
     * tick; each outer action advances it by one). Relies on the linear-history
     * contract of {@link SnapshotInspectorOptions.getActionLog} — duplicate
     * `tickApplied` values in the window would overshoot the target tick.
     */
    #reconstructFromMemento(tick: number): Readonly<TState> {
        let base: InspectorMemento<TState> | undefined;
        for (const memento of this.#getMementos()) {
            if (
                memento.tickAtTurnStart <= tick &&
                (base === undefined || memento.tickAtTurnStart > base.tickAtTurnStart)
            ) {
                base = memento;
            }
        }
        if (base === undefined) {
            throw new TickNotAvailableError(tick, 'no_memento_at_or_before_tick');
        }
        if (base.tickAtTurnStart === tick) {
            return base.snapshotAtTurnStart;
        }
        const baseTick = base.tickAtTurnStart;
        const entries = this.#getActionLog().filter(
            (entry) => entry.tickApplied >= baseTick && entry.tickApplied < tick,
        );
        const reconstructed = this.#replay(base.snapshotAtTurnStart, entries);
        if (reconstructed.tick !== tick) {
            throw new TickNotAvailableError(tick, 'reconstruction_tick_mismatch');
        }
        return reconstructed;
    }
}
