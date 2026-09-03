/**
 * simulation/engine/UndoManager.ts
 *
 * UndoManager interface, InMemoryUndoManager, InMemoryActionHistory,
 * TurnMemento, ActionHistoryEntry, ActionHistory, and UndoNotAllowedError.
 *
 * Architecture reference: §4.5, §7
 *
 * Strategy: Hybrid Memento + Event Sourcing.
 *   - `saveTurnMemento()` stores a full BaseGameSnapshot at turn start.
 *   - `undo(steps)` retrieves the most recent memento and replays
 *     `ActionHistory.sinceLastMemento()` entries except the last `steps`
 *     using the injected `replay` callback.
 *   - `redo(steps)` replays previously undone entries from the redo buffer.
 *   - `clearUndoHistory()` is called on `engine:end_turn` (crossTurnUndo default).
 *
 * Invariants upheld:
 *   #7  — engine:undo and engine:redo enter the pipeline normally via Stage 3
 *          (intercept). There is no side-door undo execution path.
 *   #43 — replay callback must not call Math.random or Date.now; this is the
 *          injected caller's responsibility, enforced by test doubles.
 */

import type { Logger } from '../foundation/logging.js';
import type { BaseGameSnapshot, ActionEnvelope, PlayerId } from './types.js';
import { DEFAULT_UNDO_POLICY } from './UndoPolicy.js';
import type { UndoPolicy } from './UndoPolicy.js';

// ─── ActionHistory constants ──────────────────────────────────────────────────

/**
 * Number of turns of undo history retained by the engine.
 * Entries whose `turnNumber` is more than `TURN_MEMENTO_RETENTION` turns in the
 * past are evicted by `pruneTo(currentTurn - TURN_MEMENTO_RETENTION)`.
 *
 * Architecture: §4.5, Invariant #45
 */
export const TURN_MEMENTO_RETENTION = 4;

/**
 * Safety-net upper bound on the number of entries in `InMemoryActionHistory`.
 * Every `append()` that would exceed this cap evicts the oldest entry; the
 * `action-history:overflow` warn reports the SATURATION, once per episode,
 * rather than once per eviction (see the latch on `InMemoryActionHistory`).
 *
 * Architecture: §4.5, Invariant #45
 */
export const MAX_ACTION_HISTORY_ENTRIES = 10_000;

// ─── Data types ───────────────────────────────────────────────────────────────

/**
 * Full game state captured at the start of a player's turn.
 * Used as the replay baseline for the undo/redo reconstruction cycle.
 *
 * Architecture: §7 — Hybrid Memento + Event Sourcing
 */
export interface TurnMemento {
    /**
     * The tick value of the snapshot when the memento was captured (= state.tick at turn start).
     *
     * Note: `BaseGameSnapshot.tick` is monotonic per applied action and is
     * recorded here for diagnostic / debugging use. The authoritative turn
     * counter is `BaseGameSnapshot.turnNumber`, which advances only on
     * `engine:end_turn`; `tickAtTurnStart` is intentionally a tick value, not
     * a turn number.
     */
    readonly tickAtTurnStart: number;
    /** The player whose turn start this memento represents. */
    readonly playerId: PlayerId;
    /** Full authoritative snapshot at turn start — the replay base. */
    readonly snapshotAtTurnStart: BaseGameSnapshot;
}

/**
 * A single entry in the action history since the last turn memento.
 *
 * Architecture: §4.5 — ActionHistory
 */
export interface ActionHistoryEntry {
    /** The tick at which the action was applied. */
    readonly tickApplied: number;
    /** The turn number during which the action was applied. */
    readonly turnNumber: number;
    /** The action envelope as it entered the pipeline. */
    readonly action: ActionEnvelope;
}

/**
 * Append-only action history.
 *
 * `sinceLastMemento()` returns the entries that survive from the segment since
 * the last `markMementoBoundary()`, or since construction if none was marked.
 * `hasEvictedSinceMemento()` reports when that is less than what was appended
 * to the segment.
 *
 * Architecture: §4.5 — ActionHistory
 */
export interface ActionHistory {
    /** Appends an entry to the history. */
    append(entry: ActionHistoryEntry): void;
    /** Marks the current append position as the start of a new undoable segment. */
    markMementoBoundary(): void;
    /**
     * Returns all entries since the most recent turn-start memento boundary.
     * The returned array is a snapshot — mutating it must not affect internal state.
     */
    sinceLastMemento(): readonly ActionHistoryEntry[];
    /**
     * Number of entries `sinceLastMemento()` would return, without building the
     * array. Callers that only need to know whether the segment is non-empty —
     * `UndoManager.canUndo`, on the per-viewer broadcast projection path — must
     * use this: the array `sinceLastMemento()` returns grows to the overflow cap.
     */
    sizeSinceLastMemento(): number;
    /**
     * True when eviction has dropped at least one entry recorded since the last
     * `markMementoBoundary()`, so what `sinceLastMemento()` returns no longer
     * begins where that boundary was set. Cleared by the next
     * `markMementoBoundary()`.
     */
    hasEvictedSinceMemento(): boolean;
    /**
     * Removes all entries whose `turnNumber` is strictly less than `cutoff`.
     * Used for memory-bounded pruning (TURN_MEMENTO_RETENTION policy).
     */
    pruneTo(cutoff: number): void;
}

// ─── UndoManager interface ────────────────────────────────────────────────────

/**
 * Manages turn-scoped undo/redo for each player using the hybrid
 * Memento + Event Sourcing strategy.
 *
 * Architecture: §4.5, §7 — UndoManager
 */
export interface UndoManager {
    /**
     * Captures a full snapshot as the turn-start baseline for the given player.
     * Must be called at the beginning of each turn (before any actions are applied).
     */
    saveTurnMemento(state: BaseGameSnapshot, playerId: PlayerId): void;

    /**
     * Reconstructs game state by replaying history minus the last `steps` entries
     * for the given player. Defaults to 1 step.
     *
     * @throws {UndoNotAllowedError} when the current policy blocks undo,
     *   no memento is stored, or `steps` exceeds available history.
     */
    undo(playerId: PlayerId, steps?: number): BaseGameSnapshot;

    /**
     * Reconstructs game state by re-applying previously undone entries.
     * Defaults to 1 step.
     *
     * @throws {UndoNotAllowedError} when there are no entries to redo.
     */
    redo(playerId: PlayerId, steps?: number): BaseGameSnapshot;

    /** Returns true when undo is allowed and there are entries to undo. */
    canUndo(playerId: PlayerId): boolean;

    /** Returns true when there are previously undone entries that can be redone. */
    canRedo(playerId: PlayerId): boolean;

    /** Replaces the current undo policy. Takes effect immediately. */
    setPolicy(policy: UndoPolicy): void;

    /**
     * Clears all undo/redo state for the given player.
     * Called on `engine:end_turn` to enforce the `crossTurnUndo: false` default.
     */
    clearUndoHistory(playerId: PlayerId): void;
}

// ─── UndoNotAllowedError ──────────────────────────────────────────────────────

/**
 * Thrown by `UndoManager.undo()` / `redo()` when the operation is not permitted.
 *
 * `reason` is a stable snake_case code suitable as an i18n key for REJECT
 * messages broadcast to clients.
 */
export class UndoNotAllowedError extends Error {
    readonly code = 'UNDO_NOT_ALLOWED' as const;
    readonly reason: string;

    constructor(reason: string) {
        super(`UndoNotAllowedError: ${reason}`);
        this.name = 'UndoNotAllowedError';
        this.reason = reason;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── InMemoryActionHistory ────────────────────────────────────────────────────

/**
 * In-memory implementation of `ActionHistory`.
 *
 * There is no reset: `markMementoBoundary()` re-bases the undoable segment, and
 * entries leave only by eviction — `maxEntries` overflow in `append()`, or
 * `pruneTo`.
 */
export class InMemoryActionHistory implements ActionHistory {
    /**
     * Underlying storage. Live entries occupy `[head, entries.length)`.
     * Slots `[0, head)` are tombstoned (already evicted) and reclaimed during
     * `#compactIfNeeded()`. Using a head cursor keeps overflow eviction in
     * `append()` and prefix removal in `pruneTo()` at O(1) amortised — the
     * O(n) `Array.shift()` / `Array.splice(0, k)` calls are eliminated from
     * the simulation hot path.
     */
    private readonly entries: ActionHistoryEntry[] = [];
    private head = 0;
    private mementoBoundary = 0;
    /**
     * Latch for the `action-history:overflow` warn. Set on the FIRST eviction,
     * cleared by a `pruneTo` that drops the live size back below capacity, so
     * each saturation episode reports exactly once.
     *
     * Saturation is a state transition — retention has just become lossy — not a
     * per-append event. Without the latch a history that stays saturated warns
     * on every append for the rest of the run, which is what a realtime host
     * does: `pruneTo` is reached from `ActionPipeline`'s `engine:end_turn` branch.
     */
    #overflowReported = false;
    /**
     * Set when `#clampMementoBoundary()` actually raises the boundary, which it
     * does exactly when eviction has taken entries the boundary was in front of.
     *
     * The head cursor destroys those entries; nothing in `sinceLastMemento()`'s
     * return value distinguishes a tail that starts at the boundary from one
     * that starts after a gap, so the gap has to be recorded here.
     */
    #evictedSinceMemento = false;
    private readonly logger: Logger | undefined;
    private readonly maxEntries: number;

    constructor(options?: {
        readonly logger?: Logger;
        /**
         * Override the overflow cap — intended for unit tests only.
         * Production callers should not set this; it defaults to
         * `MAX_ACTION_HISTORY_ENTRIES`.
         */
        readonly maxEntries?: number;
    }) {
        this.logger = options?.logger;
        this.maxEntries = options?.maxEntries ?? MAX_ACTION_HISTORY_ENTRIES;
    }

    append(entry: ActionHistoryEntry): void {
        if (this.#size() >= this.maxEntries) {
            this.head++;
            this.#clampMementoBoundary();
            // Eviction itself is unconditional; only the REPORT is latched.
            if (!this.#overflowReported) {
                this.#overflowReported = true;
                this.logger?.warn('action-history:overflow', {
                    capacity: this.maxEntries,
                });
            }
        }
        this.entries.push(entry);
        this.#compactIfNeeded();
    }

    markMementoBoundary(): void {
        this.mementoBoundary = this.entries.length;
        this.#clampMementoBoundary();
        // The new baseline is anchored to the live tail, so whatever eviction
        // took before it is no longer between a baseline and its segment.
        this.#evictedSinceMemento = false;
    }

    sinceLastMemento(): readonly ActionHistoryEntry[] {
        return this.entries.slice(this.#mementoStart());
    }

    sizeSinceLastMemento(): number {
        return this.entries.length - this.#mementoStart();
    }

    hasEvictedSinceMemento(): boolean {
        return this.#evictedSinceMemento;
    }

    pruneTo(cutoff: number): void {
        // Advance the head past any entries whose turnNumber is below the cutoff.
        // O(k) where k is the number of evicted entries — never re-touches
        // already-live elements, unlike `splice(0, k)`.
        while (this.head < this.entries.length && this.entries[this.head]!.turnNumber < cutoff) {
            this.head++;
        }
        this.#clampMementoBoundary();
        this.#compactIfNeeded();
        // Re-arm only on a prune that actually freed space. A `pruneTo` that
        // evicts nothing leaves the history saturated, so nothing transitioned
        // and the next append must not re-report the same episode. `#size()`,
        // not `entries.length`: the two differ while the head cursor still holds
        // tombstoned slots `#compactIfNeeded()` has not reclaimed, and it is the
        // live size the eviction branch compares on.
        if (this.#size() < this.maxEntries) {
            this.#overflowReported = false;
        }
    }

    /**
     * Index the undoable segment starts at. Both readers derive from it; that
     * they agree is pinned by the `sizeSinceLastMemento` describe block in
     * `ActionHistory.test.ts`.
     */
    #mementoStart(): number {
        return Math.max(this.head, this.mementoBoundary);
    }

    #size(): number {
        return this.entries.length - this.head;
    }

    /**
     * Reclaim tombstoned slots when they grow beyond the live region.
     * Bounded amortised cost: total work across N appends is O(N) because
     * each entry is copied at most once before being dropped permanently.
     * Total memory is bounded by `2 * maxEntries`.
     */
    #compactIfNeeded(): void {
        if (this.head > 0 && this.head >= this.entries.length - this.head) {
            const removed = this.head;
            this.entries.splice(0, this.head);
            this.mementoBoundary = Math.max(0, this.mementoBoundary - removed);
            this.head = 0;
        }
    }

    #clampMementoBoundary(): void {
        if (this.mementoBoundary < this.head) {
            this.mementoBoundary = this.head;
            this.#evictedSinceMemento = true;
        }
    }
}

// ─── InMemoryUndoManager ──────────────────────────────────────────────────────

/**
 * In-memory implementation of `UndoManager`.
 *
 * Uses a per-player virtual history cursor to enable multiple sequential
 * undo/redo calls without mutating the injected `ActionHistory`.
 *
 * @param history    - Shared action history for the current turn.
 * @param policy     - Initial undo policy; defaults to `DEFAULT_UNDO_POLICY`.
 * @param replay     - Pure callback that replays entries on top of a base state.
 *                     Must not call `Math.random()` or `Date.now()` (invariant #43).
 */
export class InMemoryUndoManager implements UndoManager {
    private currentPolicy: UndoPolicy;

    /** Per-player turn-start mementos. */
    private readonly mementos = new Map<PlayerId, TurnMemento>();

    /**
     * Per-player virtual history: the "effective" entries after accounting for
     * any undo operations. `undefined` means the player has not performed any
     * undo since their last `saveTurnMemento` and we should read from `history`
     * directly.
     */
    private readonly virtualHistory = new Map<PlayerId, readonly ActionHistoryEntry[]>();

    /** Per-player redo buffer: entries that have been undone and can be redone. */
    private readonly redoBuffer = new Map<PlayerId, readonly ActionHistoryEntry[]>();

    /** Per-player counter of undo steps taken since last `saveTurnMemento`. */
    private readonly undoStepsTaken = new Map<PlayerId, number>();

    constructor(
        private readonly history: ActionHistory,
        policy: UndoPolicy = DEFAULT_UNDO_POLICY,
        private readonly replay: (
            state: BaseGameSnapshot,
            entries: readonly ActionHistoryEntry[],
        ) => BaseGameSnapshot,
    ) {
        this.currentPolicy = policy;
    }

    saveTurnMemento(state: BaseGameSnapshot, playerId: PlayerId): void {
        this.history.markMementoBoundary();
        this.mementos.set(playerId, {
            tickAtTurnStart: state.tick,
            playerId,
            snapshotAtTurnStart: state,
        });
        this.virtualHistory.delete(playerId);
        this.redoBuffer.delete(playerId);
        this.undoStepsTaken.delete(playerId);
    }

    canUndo(playerId: PlayerId): boolean {
        if (!this.currentPolicy.allowUndo) {
            return false;
        }
        if (!this.mementos.has(playerId)) {
            return false;
        }
        const virtual = this.virtualHistory.get(playerId);
        if (virtual === undefined && this.history.hasEvictedSinceMemento()) {
            return false;
        }
        // Size, not the entries: this sits on the per-viewer broadcast
        // projection path, where `sinceLastMemento()` would copy a list that
        // grows to `MAX_ACTION_HISTORY_ENTRIES`. The per-player virtual history
        // is already an array this manager owns, so its length is free.
        const effectiveSize = virtual?.length ?? this.history.sizeSinceLastMemento();
        if (effectiveSize === 0) {
            return false;
        }
        if (this.currentPolicy.maxUndoSteps > 0) {
            const taken = this.undoStepsTaken.get(playerId) ?? 0;
            if (taken >= this.currentPolicy.maxUndoSteps) {
                return false;
            }
        }
        return true;
    }

    canRedo(playerId: PlayerId): boolean {
        return (this.redoBuffer.get(playerId)?.length ?? 0) > 0;
    }

    undo(playerId: PlayerId, steps = 1): BaseGameSnapshot {
        if (!this.canUndo(playerId)) {
            throw new UndoNotAllowedError(this.refusalReason(playerId));
        }

        // canUndo() above verifies mementos.has(playerId), so this cannot be undefined.
        // Guard explicitly to avoid non-null assertion and localise the contract.
        const memento = this.mementos.get(playerId);
        if (memento === undefined) {
            throw new UndoNotAllowedError('no_memento');
        }
        const entries = this.getEffectiveEntries(playerId);

        if (entries.length < steps) {
            throw new UndoNotAllowedError('not_enough_history');
        }

        const replayEntries = entries.slice(0, entries.length - steps);
        const undoneEntries = entries.slice(entries.length - steps);

        // Update virtual history to the post-undo state
        this.virtualHistory.set(playerId, replayEntries);

        // Prepend newly undone entries to the redo buffer (most recent undo first)
        const existingRedo = this.redoBuffer.get(playerId) ?? [];
        this.redoBuffer.set(playerId, [...undoneEntries, ...existingRedo]);

        // Track undo steps for maxUndoSteps enforcement
        const taken = this.undoStepsTaken.get(playerId) ?? 0;
        this.undoStepsTaken.set(playerId, taken + steps);

        return this.replay(memento.snapshotAtTurnStart, replayEntries);
    }

    redo(playerId: PlayerId, steps = 1): BaseGameSnapshot {
        if (!this.canRedo(playerId)) {
            throw new UndoNotAllowedError('no_redo_available');
        }

        // canRedo() guarantees redoBuffer is non-empty; a non-empty redoBuffer can only
        // be populated via undo(), which itself requires a memento — so the memento is
        // guaranteed to exist here. Guard explicitly to avoid non-null assertion.
        const memento = this.mementos.get(playerId);
        if (memento === undefined) {
            throw new UndoNotAllowedError('no_memento');
        }
        const redoEntries = this.redoBuffer.get(playerId) ?? [];
        const entriesToRedo = redoEntries.slice(0, steps);
        const remainingRedo = redoEntries.slice(steps);

        const currentVirtual = this.getEffectiveEntries(playerId);
        const newVirtual = [...currentVirtual, ...entriesToRedo];

        this.virtualHistory.set(playerId, newVirtual);
        this.redoBuffer.set(playerId, remainingRedo);

        // Decrement undo step counter by the number of steps redone
        const taken = this.undoStepsTaken.get(playerId) ?? 0;
        this.undoStepsTaken.set(playerId, Math.max(0, taken - steps));

        return this.replay(memento.snapshotAtTurnStart, newVirtual);
    }

    setPolicy(policy: UndoPolicy): void {
        this.currentPolicy = policy;
    }

    clearUndoHistory(playerId: PlayerId): void {
        this.mementos.delete(playerId);
        this.virtualHistory.delete(playerId);
        this.redoBuffer.delete(playerId);
        this.undoStepsTaken.delete(playerId);
    }

    /**
     * The reason `canUndo` refused. Which arm answers for which refusal — and in
     * what order — is pinned by the `undo — refusal reason` describe block in
     * `UndoManager.test.ts`.
     *
     * The evicted-segment arm reuses `not_enough_history` rather than minting a
     * code: the entries between the memento's baseline and the surviving tail
     * are exactly the history this undo needs and no longer has.
     */
    private refusalReason(playerId: PlayerId): string {
        if (!this.currentPolicy.allowUndo) {
            return 'policy_disallows';
        }
        if (!this.mementos.has(playerId)) {
            return 'no_memento';
        }
        if (
            this.virtualHistory.get(playerId) === undefined &&
            this.history.hasEvictedSinceMemento()
        ) {
            return 'not_enough_history';
        }
        return 'max_steps_reached';
    }

    /**
     * Returns the current effective entries for `playerId`.
     * Uses virtual history if set (after an undo); otherwise falls back to
     * reading `history.sinceLastMemento()` directly.
     */
    private getEffectiveEntries(playerId: PlayerId): readonly ActionHistoryEntry[] {
        return this.virtualHistory.get(playerId) ?? this.history.sinceLastMemento();
    }
}
