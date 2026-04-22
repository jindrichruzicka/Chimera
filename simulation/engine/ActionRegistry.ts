/**
 * simulation/engine/ActionRegistry.ts
 *
 * Maps action type strings to their ActionDefinition strategies.
 * Enforces the engine: namespace collision guard (invariant #2).
 *
 * Architecture reference: §4.7
 * Task: F03 / T3 (issue #26)
 *
 * Invariants upheld:
 *   #2 — The engine: namespace is reserved exclusively for EngineActions.
 *         Game plugins cannot shadow reserved engine actions.
 *   #3 — simulation/ is side-effect-free; no Node.js or Electron imports.
 */

import type { ActionDefinition, BaseGameSnapshot } from './types.js';

// ─── Error classes ────────────────────────────────────────────────────────────

/**
 * Thrown by ActionRegistry.register() when a game plugin attempts to register
 * an action type that begins with the reserved 'engine:' prefix.
 *
 * The 'engine:' namespace is reserved exclusively for EngineActions and may
 * only be populated via ActionRegistry.registerEngineAction() (internal path).
 */
export class NamespaceCollisionError extends Error {
    readonly code = 'NAMESPACE_COLLISION' as const;

    constructor(type: string) {
        super(
            `NamespaceCollisionError: action type "${type}" uses the reserved "engine:" ` +
                `namespace. Only the engine core may register engine: actions. ` +
                `Use a game-specific prefix (e.g. "mygame:${type.replace(/^engine:/, '')}").`,
        );
        this.name = 'NamespaceCollisionError';
        // Restore prototype chain — required when targeting ES5 or extending built-ins.
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown by ActionRegistry.resolve() when the requested action type has not
 * been registered.
 *
 * The `type` property exposes the queried string so callers can include it in
 * REJECT broadcasts or diagnostic messages without re-parsing the error message.
 */
export class UnknownActionTypeError extends Error {
    readonly code = 'UNKNOWN_ACTION_TYPE' as const;
    readonly type: string;

    constructor(type: string) {
        super(
            `UnknownActionTypeError: no ActionDefinition is registered for action type "${type}". ` +
                `Ensure the game registers all its actions before the tick loop starts.`,
        );
        this.name = 'UnknownActionTypeError';
        this.type = type;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── ActionRegistry ───────────────────────────────────────────────────────────

/** Reserved prefix that only the engine core may use. */
const ENGINE_NAMESPACE = 'engine:' as const;

/**
 * Maps action type strings to their ActionDefinition strategies.
 *
 * Created once per game session and populated during game initialisation
 * before the tick loop starts. The registry is the exclusive authority on
 * which action types are legal — ActionPipeline.process() calls resolve()
 * at Stage 1 for every incoming action.
 *
 * Type parameter `TState` constrains the snapshot type all definitions in
 * this registry operate on. Consumer code typically passes the concrete
 * game snapshot type (e.g. `ActionRegistry<TacticsSnapshot>`).
 *
 * Invariant: game code must ONLY call `register()`. The `registerEngineAction()`
 * method is reserved for the engine-internal EngineActions registration path
 * (F03 T4) and must never be called from games/* or renderer/*.
 */
export class ActionRegistry<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #definitions = new Map<string, ActionDefinition<Record<string, unknown>, TState>>();

    /**
     * Register a game-defined ActionDefinition.
     *
     * Throws `NamespaceCollisionError` if `definition.type` begins with `engine:`.
     * All registrations are idempotent for the same type (last write wins) —
     * duplicate registrations are a development-time misconfiguration and
     * produce a console warning in dev builds only.
     */
    register<TPayload extends Record<string, unknown>>(
        definition: ActionDefinition<TPayload, TState>,
    ): void {
        if (definition.type.startsWith(ENGINE_NAMESPACE)) {
            throw new NamespaceCollisionError(definition.type);
        }
        this.#definitions.set(definition.type, definition);
    }

    /**
     * Engine-internal registration path.
     *
     * Registers an ActionDefinition whose type begins with `engine:`.
     * This method MUST NOT be called from game code or renderer code.
     * It exists solely for use by EngineActions (F03 T4) to populate the
     * reserved engine: namespace at engine initialisation time.
     *
     * Invariant: only called from simulation/engine/EngineActions.ts.
     */
    registerEngineAction<TPayload extends Record<string, unknown>>(
        definition: ActionDefinition<TPayload, TState>,
    ): void {
        this.#definitions.set(definition.type, definition);
    }

    /**
     * Look up the ActionDefinition for the given type string.
     *
     * Throws `UnknownActionTypeError` if the type has not been registered.
     * Called by ActionPipeline at Stage 1 (resolve) for every incoming action.
     */
    resolve(type: string): ActionDefinition<Record<string, unknown>, TState> {
        const definition = this.#definitions.get(type);
        if (definition === undefined) {
            throw new UnknownActionTypeError(type);
        }
        return definition;
    }

    /**
     * Returns true if a definition for `type` has been registered, false otherwise.
     *
     * Useful for guard clauses and dev-time assertions. Does not throw.
     */
    has(type: string): boolean {
        return this.#definitions.has(type);
    }

    /**
     * Returns an immutable snapshot of all currently registered type strings.
     *
     * Includes both game-namespaced types and any engine: types registered via
     * registerEngineAction(). Callers must not modify the returned array.
     */
    registeredTypes(): readonly string[] {
        return Array.from(this.#definitions.keys());
    }
}
