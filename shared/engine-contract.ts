/**
 * shared/engine-contract.ts
 *
 * Foundation brand/contract types for the Chimera engine.
 *
 * These are the canonical declarations of the core engine identifiers and the
 * action envelope. They live in `@chimera/shared` — the zero-dependency
 * foundation leaf — so that the foundation can describe wire/screen contracts
 * (messages, chat, game-screen) without importing *up* into `simulation`
 * (Invariant #1: the contract layer points inward only). `simulation/engine/`
 * re-exports every name here, keeping `@chimera/simulation/engine/types.js` the
 * unchanged public import path for the rest of the codebase; the runtime brand
 * factories (`playerId`, `entityId`, `gamePhase`, `sceneId`) also stay there.
 *
 * This module is PURE TYPE DECLARATIONS only — zero runtime code, zero workspace
 * imports.
 *
 * Architecture references: §4.2, §4.7. Relocated under issue #758.
 */

// ─── Primitive branded identifiers ───────────────────────────────────────────

/**
 * Opaque player identifier. Using a branded type prevents accidental mixing
 * with other string-shaped values (e.g. session tokens, entity IDs).
 *
 * Canonical source — supersedes the plain `string` stub in `electron/preload/api-types.ts`.
 */
export type PlayerId = string & { readonly __brand: 'PlayerId' };

/**
 * Opaque entity identifier. Branded to prevent mix-up with PlayerId or
 * other string keys at call sites.
 */
export type EntityId = string & { readonly __brand: 'EntityId' };

/**
 * Current phase of the game state machine.
 * Games define their own phase strings; the engine treats this as an opaque
 * string. Typed as a branded alias to prevent accidental assignment of
 * arbitrary strings without intent.
 */
export type GamePhase = string & { readonly __brand: 'GamePhase' };

/**
 * Opaque scene identifier. Scene ids are namespaced strings such as
 * `engine:game` or `tactics:level-1`.
 */
export type SceneId = string & { readonly __brand: 'SceneId' };

export type SceneTransitionPhase = 'preparing' | 'ready' | 'committing';

export interface SceneTransitionState {
    readonly toSceneId: SceneId;
    readonly phase: SceneTransitionPhase;
    readonly startedAtTick: number;
    readonly params: Readonly<Record<string, unknown>>;
    readonly playersReady: readonly PlayerId[];
    readonly timeoutTicks?: number;
    readonly onClientTimeout?: 'proceed' | 'drop';
}

// ─── Game result ────────────────────────────────────────────────────────────

/**
 * The canonical outcome of a completed game.
 *
 * `winnerIds` contains the IDs of every winning player. An empty array
 * represents a draw. The type intentionally exposes only `winnerIds` —
 * no internal resolver state may be included (Invariant #1).
 *
 * Architecture reference: §4.38 — Game Resolution & Winner Detection
 */
export interface GameResult {
    readonly winnerIds: readonly PlayerId[];
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Generic action envelope. The ONLY shape the engine transport layer
 * operates on. Games create typed sub-forms via `TypedAction<T, P>`.
 *
 * `TType`    — namespaced type string, e.g. `'engine:end_turn'`, `'mygame:move_unit'`
 * `TPayload` — strongly-typed payload; unknown/unvalidated on the wire until
 *              `ActionDefinition.parsePayload()` runs inside ActionPipeline Stage 2.
 *
 * INVARIANT: `tick` must match `GameSnapshot.tick` at pipeline entry; Stage 1
 * (resolve) rejects stale envelopes before any game logic runs.
 */
export interface EngineAction<
    TType extends string = string,
    TPayload extends object = Record<string, unknown>,
> {
    readonly type: TType;
    readonly playerId: PlayerId;
    readonly tick: number;
    readonly payload: Readonly<TPayload>;
}

/**
 * Convenience type alias for game developers building typed action factories.
 *
 * Usage:
 *   type MoveUnitAction = TypedAction<'mygame:move_unit', MoveUnitPayload>;
 */
export type TypedAction<T extends string, P extends object> = EngineAction<T, P>;

/**
 * The exclusive inbound representation at the transport boundary — opaque form
 * of `EngineAction` with default loose type parameters. ActionPipeline receives
 * only `ActionEnvelope`s; stage 2 (parse) produces the typed payload for game code.
 *
 * INVARIANT #1: No raw `{ type, payload }` objects may enter the pipeline —
 * callers must build an `ActionEnvelope` (including `playerId` and `tick`).
 */
export type ActionEnvelope = EngineAction<string, Record<string, unknown>>;
