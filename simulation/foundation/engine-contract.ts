/**
 * simulation/foundation/engine-contract.ts
 *
 * Foundation brand/contract types for the Chimera engine.
 *
 * These are the canonical declarations of the core engine identifiers and the
 * action envelope. They live in `@chimera-engine/simulation/foundation` — the zero-dependency
 * foundation leaf — so that the foundation can describe wire/screen contracts
 * (messages, chat, game-screen) without importing *up* into `simulation`
 * (Invariant #1: the contract layer points inward only). `simulation/engine/`
 * re-exports every name here, keeping `@chimera-engine/simulation/engine/types.js` the
 * unchanged public import path for the rest of the codebase; the runtime brand
 * factories (`playerId`, `entityId`, `gamePhase`, `sceneId`) also stay there.
 *
 * This module is PURE TYPE DECLARATIONS only — zero runtime code.
 *
 * Architecture references: §4.2, §4.7.
 */

import type { AssetRef } from './asset-contract.js';

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
    /**
     * Set by `engine:scene_expire` when the HOST declares its own budget for
     * this transition elapsed, and read as a second way of being timed out
     * beside `timeoutTicks`.
     *
     * It exists because the tick budget cannot always be reached: the barrier
     * waits on an ack from every seat, `engine:scene_ready` is produced only
     * inside a mounted `SceneRouter`, and a seat with no renderer — an AI seat,
     * a disconnect mid-transition — never sends one. The tick advances only
     * when an action is applied, so in a turn-based match nothing closes the
     * gap and the transition holds forever.
     *
     * The wall clock stays OUT of the reduce: the host measures the wait and
     * dispatches an action, and the reduce reads only this flag. What the
     * expiry then MEANS is unchanged — the descriptor's own `onClientTimeout`
     * still decides between committing and dropping.
     *
     * Omitted rather than `false` while a transition is live, so a transition
     * that never expires keeps the shape it had before this field existed.
     */
    readonly expired?: boolean;
    /**
     * The refs the scene being entered declares in its
     * `SceneDescriptor.requiredAssets` (Invariant #52), copied onto the
     * transition so a client can preload them while the transition is pending.
     * The descriptor is host-side only; for the scene already entered the
     * declaration travels on `BaseGameSnapshot.sceneRequiredAssets` instead.
     *
     * Omitted — not empty — when the target scene declares none, which keeps
     * the transition shape of a scene that needs nothing byte-identical to
     * what it was before the field existed.
     */
    readonly requiredAssets?: readonly AssetRef[];
    /**
     * The screen key the scene being entered declares in its
     * `SceneDescriptor.defaultScreen`, copied onto the transition for the same
     * reason `requiredAssets` is: the descriptor is host-side only, and a client
     * needs the key before the scene is committed in order to resolve the
     * entering scene's loading cover.
     *
     * Without it the renderer can only read its own
     * `GameScreenRegistry.sceneDefaultScreens` map, which a game registering a
     * scene has no reason to also populate, and the omission showed up only as
     * the engine's default cover replacing the declared one.
     *
     * The renderer PREFERS this over its map rather than replacing it: a host
     * that does not emit the field must still resolve through the map.
     *
     * Optional so a transition minted before the field existed still parses.
     */
    readonly defaultScreen?: string;
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
