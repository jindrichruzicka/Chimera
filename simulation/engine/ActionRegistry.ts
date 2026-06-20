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

import type {
    ActionDefinition,
    BaseGameSnapshot,
    GameResult,
    GameSetupConfig,
    PlayerId,
    ValidationResult,
} from './types.js';

export interface GameDefinition<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    /**
     * Called once by the host when a session is being created for this game.
     * Receives the player IDs in insertion order and, optionally, the
     * host-authored lobby `setup` (chosen match settings + per-player
     * attributes) so the game can seed starting entities from it (§4.37, #705).
     * `setup` is optional and absent for games with no lobby config.
     */
    readonly buildInitialEntities?: (
        playerIds: readonly PlayerId[],
        setup?: GameSetupConfig,
    ) => TState['entities'];
    /**
     * Pure post-reduce resolver for completed games (§4.38).
     * Returns `null` while the game is still active; returns a GameResult
     * when the supplied snapshot satisfies the game's win/draw condition.
     */
    readonly resolveGameResult?: (snapshot: Readonly<TState>) => GameResult | null;
    /**
     * Optional pure guard consulted by `engine:end_turn.validate()` AFTER the
     * generic active-player checks. Returns `{ ok: false, reason }` to block the
     * end-turn — e.g. commit-then-sync turn modes reject until every seated
     * player has committed for the current turn (§4.6/§8, F54). Absent ⇒ no extra
     * gate, so sequential games and games with no turn modes are unaffected.
     *
     * Keeps the generic engine ignorant of any specific game: the engine consults
     * this through `GameReduceContext.endTurnGuard` (Invariant #102), which
     * `ActionPipeline` populates from this hook.
     */
    readonly canEndTurn?: (state: Readonly<TState>, playerId: PlayerId) => ValidationResult;
    /**
     * Optional pure end-turn AUTHORIZATION that REPLACES the engine's built-in
     * active-player check in `engine:end_turn.validate()`. Returns `true` if
     * `playerId` may end the turn from the supplied state, `false` otherwise.
     *
     * Sequential games omit this (the engine keeps "only the active seat may end
     * the turn"). Simultaneous commit-then-sync mode supplies it so any seated
     * player may fire the reveal once every seat has committed — a pure
     * active-player gate would deadlock a parallel turn (§4.6/§8, F54). Consulted
     * before `canEndTurn`, which still gates the reason (e.g. `awaiting_commitment`).
     *
     * Reaches the engine ignorant of any specific game via
     * `GameReduceContext.endTurnAuthority` (Invariant #102), which `ActionPipeline`
     * populates from this hook.
     */
    readonly mayEndTurn?: (state: Readonly<TState>, playerId: PlayerId) => boolean;
}

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
    readonly #definitions = new Map<string, ActionDefinition<object, TState>>();
    readonly #gameDefinitions = new Map<string, GameDefinition<TState>>();

    /**
     * Register a game-defined ActionDefinition.
     *
     * Throws `NamespaceCollisionError` if `definition.type` begins with `engine:`.
     * All registrations are idempotent for the same type (last write wins) —
     * duplicate registrations are a development-time misconfiguration and
     * produce a console warning in dev builds only.
     */
    register<TPayload extends object>(definition: ActionDefinition<TPayload, TState>): void {
        if (definition.type.startsWith(ENGINE_NAMESPACE)) {
            throw new NamespaceCollisionError(definition.type);
        }
        this.#definitions.set(definition.type, definition);
    }

    /**
     * Bulk-register an array of game-defined ActionDefinitions (Appendix C.4).
     *
     * Each definition is routed through the SAME validation path as `register()`:
     * an `engine:`-prefixed type throws `NamespaceCollisionError` (Invariant #11),
     * so games/extensions cannot register engine actions via the merge, and a true
     * duplicate type follows `register()`'s idempotent last-write-wins contract
     * (no error). This enables extension libraries to pre-register their shared
     * action definitions once instead of forcing adopters to re-register each.
     *
     * NOT transactional: definitions are registered in iteration order. If one
     * throws (reserved `engine:` namespace), every definition before it stays
     * registered (partial merge); the offending definition and those after it
     * do not.
     */
    mergeFrom(definitions: readonly ActionDefinition<object, TState>[]): void {
        for (const definition of definitions) {
            this.register(definition);
        }
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
    registerEngineAction<TPayload extends object>(
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
    resolve(type: string): ActionDefinition<object, TState> {
        const definition = this.#definitions.get(type);
        if (definition === undefined) {
            throw new UnknownActionTypeError(type);
        }
        return definition;
    }

    /**
     * Register a game-level definition for host-side game initialisation hooks.
     */
    registerGame(gameId: string, definition: GameDefinition<TState>): void {
        this.#gameDefinitions.set(gameId, definition);
    }

    /**
     * Look up the game-level definition for the given game id, if one exists.
     */
    resolveGame(gameId: string): GameDefinition<TState> | undefined {
        return this.#gameDefinitions.get(gameId);
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
