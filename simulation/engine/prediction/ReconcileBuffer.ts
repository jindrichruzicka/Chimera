/**
 * simulation/engine/prediction/ReconcileBuffer.ts
 *
 * Holds a bounded queue of unconfirmed `EngineAction`s submitted optimistically
 * before the authoritative snapshot arrives. On each authoritative
 * `PlayerSnapshot`, `ReconcileBuffer.reconcile()` evicts all actions whose
 * originating tick has been confirmed (`action.tick <= snapshot.tick`) and
 * replays any remaining unconfirmed actions via `ClientPredictor`, returning
 * the reconciled snapshot.
 *
 * Architecture reference: §6 — simulation/prediction/ · Client Prediction
 * Task: F18 (issue #367)
 *
 * Invariants upheld:
 *   #1 — simulation/ is side-effect-free; no Node.js or Electron imports.
 *   #2 — applyAction/definition.reduce are pure — reconcile replay produces
 *         no side effects.
 *   #3 — GameSnapshot never leaves the main process; ReconcileBuffer
 *         operates on BaseGameSnapshot (PlayerSnapshot shape) only.
 *   #43 — No Math.random, Date.now, performance.now inside the buffer.
 *
 * Module boundaries (hard constraints):
 *   May import from: simulation/engine, shared/
 *   Must NOT import from: renderer/, electron/, games/*, any DOM API
 */

import type { Logger } from '../../../shared/logging.js';
import type { BaseGameSnapshot, EngineAction } from '../types.js';
import type { ClientPredictor } from './ClientPredictor.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of unconfirmed actions the buffer will hold at any time.
 * When `enqueue` would exceed this limit, the oldest action is silently
 * evicted and a warning is logged via the injected `Logger` (if present).
 */
export const MAX_BUFFER_DEPTH = 32;

// ─── Options ─────────────────────────────────────────────────────────────────

export interface ReconcileBufferOptions {
    /**
     * Optional structured logger. When provided, a `warn`-level entry is
     * emitted whenever the buffer depth limit is exceeded and an old action
     * is evicted. If omitted, evictions are silent.
     */
    readonly logger?: Logger;
}

// ─── ReconcileBuffer ──────────────────────────────────────────────────────────

/**
 * Bounded queue of optimistically-applied, not-yet-confirmed `EngineAction`s.
 *
 * `TState` — the game snapshot type this buffer operates on;
 *             defaults to `BaseGameSnapshot`. In practice callers pass the
 *             concrete game snapshot type (e.g. `TacticsSnapshot`).
 *
 * Usage:
 * ```ts
 * // On user action (before host confirms):
 * buffer.enqueue(action);
 *
 * // On each authoritative snapshot from the host:
 * const predicted = buffer.reconcile(authoritativeSnapshot, predictor);
 * gameStore.applySnapshot(predicted);
 *
 * // On game end:
 * buffer.clear();
 * ```
 */
export class ReconcileBuffer<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #queue: EngineAction[] = [];
    readonly #logger: Logger | undefined;

    constructor(options: ReconcileBufferOptions = {}) {
        this.#logger = options.logger;
    }

    // ── pendingCount ──────────────────────────────────────────────────────────

    /**
     * The current number of unconfirmed actions waiting to be replayed.
     * Observable by `PredictionStore` for UI indicators.
     */
    get pendingCount(): number {
        return this.#queue.length;
    }

    // ── enqueue ───────────────────────────────────────────────────────────────

    /**
     * Adds `action` to the tail of the buffer.
     *
     * If the buffer is already at `MAX_BUFFER_DEPTH`, the oldest (head)
     * action is evicted before inserting the new one and a `warn`-level
     * log entry is emitted via the injected logger (if present).
     */
    enqueue(action: EngineAction): void {
        if (this.#queue.length >= MAX_BUFFER_DEPTH) {
            const evicted = this.#queue.shift();
            this.#logger?.warn(
                'ReconcileBuffer: buffer depth limit exceeded; evicting oldest unconfirmed action',
                { maxBufferDepth: MAX_BUFFER_DEPTH, evictedActionType: evicted?.type },
            );
        }
        this.#queue.push(action);
    }

    // ── reconcile ─────────────────────────────────────────────────────────────

    /**
     * Reconciles the authoritative snapshot against the pending action queue.
     *
     * Steps:
     * 1. Evict all actions whose `tick` ≤ `authoritativeSnapshot.tick`
     *    (these have been confirmed by the host; replaying them would
     *    double-apply them).
     * 2. Replay each remaining unconfirmed action on top of the authoritative
     *    snapshot via `predictor.applyOptimistic()`.
     * 3. Return the resulting snapshot.
     *
     * Returns `authoritativeSnapshot` unchanged (same reference) when the
     * buffer is empty or all buffered actions have been confirmed.
     *
     * Actions that are not marked `predictable: true` in their
     * `ActionDefinition` will cause `ClientPredictor` to throw
     * `NonPredictableActionError`. It is the caller's responsibility to
     * enqueue only predictable actions.
     */
    reconcile(authoritativeSnapshot: TState, predictor: ClientPredictor<TState>): TState {
        // Step 1: evict confirmed entries
        while (this.#queue.length > 0 && this.#queue[0]!.tick <= authoritativeSnapshot.tick) {
            this.#queue.shift();
        }

        // Step 2: short-circuit when nothing to replay
        if (this.#queue.length === 0) {
            return authoritativeSnapshot;
        }

        // Step 3: replay unconfirmed actions
        let state: TState = authoritativeSnapshot;
        for (const action of this.#queue) {
            state = predictor.applyOptimistic(state, action);
        }
        return state;
    }

    // ── clear ─────────────────────────────────────────────────────────────────

    /**
     * Empties the buffer. Call on game end or on a hard resync to discard all
     * pending speculative state.
     */
    clear(): void {
        this.#queue.length = 0;
    }
}
