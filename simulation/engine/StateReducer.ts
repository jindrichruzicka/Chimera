/**
 * simulation/engine/StateReducer.ts
 *
 * `ActionSchemaError` — error thrown when `ActionDefinition.parsePayload()`
 * raises for an inbound action. Wraps whatever error `parsePayload` raised so
 * callers get a stable, discriminated error type regardless of what the
 * definition threw.
 *
 * `StateReducer` — thin delegator that resolves an `ActionDefinition` from the
 * registry, parses the raw payload via `parsePayload()`, and calls
 * `def.reduce()`. Used internally by `ActionPipeline` at Stage 5 and available
 * as a standalone component for replay and AI consumers that need raw reduction
 * without the full 7-stage pipeline ceremony.
 *
 * Does NOT perform tick validation, authorization, history recording, or
 * snapshot broadcasting — those belong to `ActionPipeline`.
 *
 * Architecture reference: §4.7
 */

import type { ActionEnvelope, BaseGameSnapshot, ReduceContext } from './types.js';
import type { ActionRegistry } from './ActionRegistry.js';

// ─── ActionSchemaError ────────────────────────────────────────────────────────

/**
 * Thrown when `ActionDefinition.parsePayload()` throws for an inbound action.
 *
 * Wraps whatever error `parsePayload` raised so callers get a stable,
 * discriminated error type regardless of what the definition threw.
 */
export class ActionSchemaError extends Error {
    readonly code = 'ACTION_SCHEMA' as const;
    readonly type: string;

    constructor(type: string, cause?: Error) {
        super(
            `ActionSchemaError: parsePayload failed for action type "${type}": ` +
                (cause?.message ?? 'unknown error'),
        );
        this.name = 'ActionSchemaError';
        this.type = type;
        if (cause !== undefined) {
            this.cause = cause;
        }
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── StateReducer ─────────────────────────────────────────────────────────────

/**
 * Thin delegator that resolves an `ActionDefinition` from the registry,
 * parses the raw payload via `parsePayload()`, and calls `def.reduce()`.
 *
 * Used internally by `ActionPipeline` at Stage 5, and available as a
 * standalone component for replay and AI consumers that need raw reduction
 * without the full 7-stage pipeline ceremony.
 *
 * Does NOT perform tick validation, authorization, history recording, or
 * snapshot broadcasting — those belong to `ActionPipeline`.
 */
export class StateReducer<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #registry: ActionRegistry<TState>;

    constructor(registry: ActionRegistry<TState>) {
        this.#registry = registry;
    }

    /**
     * Resolve the `ActionDefinition` for `action.type`, parse its payload,
     * and apply the reducer to produce the next state.
     *
     * Throws:
     *   - `UnknownActionTypeError` if `action.type` is not registered.
     *   - `ActionSchemaError` if `parsePayload` throws.
     */
    apply(state: Readonly<TState>, action: ActionEnvelope, ctx: ReduceContext): TState {
        const def = this.#registry.resolve(action.type);

        let parsedPayload: Record<string, unknown>;
        try {
            parsedPayload = def.parsePayload(action.payload);
        } catch (err) {
            throw new ActionSchemaError(
                action.type,
                err instanceof Error ? err : new Error(String(err)),
            );
        }

        return def.reduce(state, parsedPayload, action.playerId, ctx);
    }
}
