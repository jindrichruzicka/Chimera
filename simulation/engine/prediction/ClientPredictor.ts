/**
 * simulation/engine/prediction/ClientPredictor.ts
 *
 * Optimistic local application of own actions for client-side prediction.
 *
 * Only processes actions whose `ActionDefinition.predictable === true`.
 * For any action where `predictable` is absent or `false`, throws
 * `NonPredictableActionError` — never silently applies unpredictable actions.
 *
 * Architecture reference: §6 — simulation/prediction/ · Client Prediction
 *
 * Invariants upheld:
 *   #1 — simulation/ is side-effect-free; no Node.js or Electron imports.
 *   #2 — applyAction/definition.reduce are pure — applyOptimistic produces no
 *         side effects.
 *   #43 — No Math.random, Date.now, performance.now; randomness is supplied via
 *          ReduceContext.rng.
 *
 * Module boundaries (hard constraints):
 *   May import from: simulation/engine, shared/
 *   Must NOT import from: renderer/, electron/, games/*, any DOM API
 */

import type { ActionRegistry } from '../ActionRegistry.js';
import type { BaseGameSnapshot, EngineAction, GameReduceContext } from '../types.js';

// ─── NonPredictableActionError ────────────────────────────────────────────────

/**
 * Thrown by `ClientPredictor.applyOptimistic()` when called with an action
 * whose `ActionDefinition.predictable` field is absent or `false`.
 *
 * The `type` property exposes the offending action type string so callers can
 * surface it in diagnostic messages without re-parsing the error message.
 */
export class NonPredictableActionError extends Error {
    readonly code = 'NON_PREDICTABLE_ACTION' as const;
    readonly type: string;

    constructor(type: string) {
        super(
            `NonPredictableActionError: action type "${type}" is not marked predictable. ` +
                `Only actions with predictable: true may be applied optimistically on the client. ` +
                `Check the ActionDefinition for "${type}" and set predictable: true if the action ` +
                `is non-randomised, own-player-only, and non-contested.`,
        );
        this.name = 'NonPredictableActionError';
        this.type = type;
        // Restore prototype chain — required when targeting ES5 or extending built-ins.
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── ClientPredictor ──────────────────────────────────────────────────────────

/**
 * Applies actions optimistically on the client before host confirmation.
 *
 * Accepts an `ActionRegistry<TState>` and a `ReduceContext`, and exposes a
 * single method: `applyOptimistic(snapshot, action)`.
 *
 * Only actions with `ActionDefinition.predictable === true` are processed. Any
 * other action causes a `NonPredictableActionError` to be thrown immediately,
 * without touching the snapshot.
 *
 * `TState` — the game snapshot type this predictor operates on;
 *             defaults to `BaseGameSnapshot`. In practice callers pass the
 *             concrete game snapshot type (e.g. `TacticsSnapshot`).
 *
 * Design note: `ClientPredictor` currently operates on the full
 * `BaseGameSnapshot`. Constraining `TState extends PlayerSnapshot` would make it
 * operate on the projected per-player view instead — a deliberately deferred
 * design decision, not yet a priority.
 */
export class ClientPredictor<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #registry: ActionRegistry<TState>;
    readonly #ctx: GameReduceContext;

    constructor(registry: ActionRegistry<TState>, ctx: GameReduceContext) {
        this.#registry = registry;
        this.#ctx = ctx;
    }

    /**
     * Applies `action` to `snapshot` optimistically and returns the resulting
     * snapshot. Calls `ActionRegistry.resolve(action.type)` to obtain the
     * `ActionDefinition`, then guards on `predictable !== true`.
     *
     * @throws {NonPredictableActionError} when `definition.predictable` is absent
     *   or `false`.
     * @throws {UnknownActionTypeError} (from `ActionRegistry.resolve`) when the
     *   action type has not been registered.
     */
    applyOptimistic(snapshot: TState, action: EngineAction): TState {
        const definition = this.#registry.resolve(action.type);

        if (definition.predictable !== true) {
            throw new NonPredictableActionError(action.type);
        }

        const payload = definition.parsePayload(action.payload);
        return definition.reduce(snapshot, payload, action.playerId, this.#ctx);
    }
}
