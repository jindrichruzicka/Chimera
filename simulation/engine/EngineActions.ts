/**
 * simulation/engine/EngineActions.ts
 *
 * Reserved engine action definitions for the Chimera simulation core.
 *
 * Defines `ActionDefinition` entries for the seven M1/M3-required engine-reserved
 * action types: `engine:tick`, `engine:end_turn`, `engine:save`, `engine:load`,
 * `engine:undo`, `engine:redo`, and `engine:sync_request`. These are the only
 * callers of the engine-internal `registerEngineAction()` bypass on `ActionRegistry`.
 *
 * Architecture reference: §4.2, §4.7
 * Task: F03 / T4 (issue #27), issue #350
 *
 * Invariants upheld:
 *   #2 — Engine reserved actions are the only mechanism for cross-cutting
 *         tick/turn lifecycle mutations. EngineActions is the sole caller of
 *         ActionRegistry.registerEngineAction().
 *   #3 — simulation/ is side-effect-free; no Node.js or Electron imports.
 *   #7 — engine:undo and engine:redo are EngineAction types; they enter the
 *         pipeline normally. There is no side-door undo path.
 *   #11 — The engine: namespace is reserved; definitions are registered only
 *          via registerEngineAction().
 *   #43 — validate() and reduce() use only ReduceContext. No Math.random() or
 *          Date.now() calls.
 */

import type {
    ActionDefinition,
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
    PlayerId,
    ValidationResult,
} from './types.js';
import { entityId, gamePhase, isReduceContext, playerId } from './types.js';
import type { ActionRegistry } from './ActionRegistry.js';
import { TimerManager } from './GameTimer.js';
import { ActionUnauthorizedError } from './ActionPipeline.js';

// ─── Payload types ────────────────────────────────────────────────────────────

/**
 * Payload for `engine:tick`.
 * `seed` is the per-tick RNG seed derived by the host at tick advance time.
 * All arithmetic fields are integers (invariant #42).
 *
 * Plain interface — no `Record<string, unknown>` intersection required now that
 * `TPayload extends object` is the constraint on `ActionDefinition`.
 */
export interface EngineTickPayload {
    readonly seed: number;
}

/**
 * Payload for `engine:end_turn`.
 * `deadlineMs` optionally overrides the next turn deadline using integer time.
 * The acting player is identified by the envelope.
 */
export interface EngineEndTurnPayload {
    readonly deadlineMs?: number;
}

/**
 * Payload for `engine:save` and `engine:load`.
 * `slotId` is the qualified slot identifier `'<gameId>/<slotName>'`.
 */
export interface EngineSaveLoadPayload {
    readonly slotId: string;
}

/**
 * Payload for `engine:undo` and `engine:redo`.
 * `steps` is the number of actions to undo/redo; defaults to 1 if absent.
 * Must be a positive integer when present (invariant #42).
 */
export interface EngineUndoRedoPayload {
    readonly steps: number;
}

/**
 * Payload for `engine:sync_request`.
 * No payload fields — requests a full state snapshot from the host.
 */
export type EngineSyncRequestPayload = Record<string, never>;

/**
 * Payload for `engine:start_match`.
 * Carries the authoritative lobby player list into the simulation snapshot at
 * match start so every current participant receives the first projected view.
 */
export interface EngineStartMatchPayload {
    readonly playerIds: readonly PlayerId[];
    readonly firstPlayerId?: PlayerId;
    readonly initialEntities?: BaseGameSnapshot['entities'];
}

const DEFAULT_TURN_DEADLINE_MS = 30_000;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnsafeObjectKey(key: string): boolean {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function copyEntityFields(entity: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const copy: Record<string, unknown> = {};
    for (const [fieldName, fieldValue] of Object.entries(entity)) {
        if (!isUnsafeObjectKey(fieldName)) {
            copy[fieldName] = fieldValue;
        }
    }
    return copy;
}

function parseInitialEntities(raw: unknown): BaseGameSnapshot['entities'] | undefined {
    if (raw === undefined) {
        return undefined;
    }
    if (!isRecord(raw)) {
        throw new TypeError(
            'engine:start_match payload "initialEntities" must be an entity map when present; ' +
                `received ${JSON.stringify(raw)}.`,
        );
    }

    const parsed: Record<EntityId, BaseEntityState> = {};
    for (const [rawEntityId, rawEntity] of Object.entries(raw)) {
        if (rawEntityId.length === 0 || isUnsafeObjectKey(rawEntityId) || !isRecord(rawEntity)) {
            throw new TypeError(
                'engine:start_match payload "initialEntities" must map non-empty entity ids to objects; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }

        const rawId = rawEntity['id'];
        if (typeof rawId !== 'string' || rawId.length === 0) {
            throw new TypeError(
                'engine:start_match payload "initialEntities" entries must include a non-empty id; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }

        const parsedId = entityId(rawId);
        const parsedEntity = {
            ...copyEntityFields(rawEntity),
            id: parsedId,
        } satisfies BaseEntityState & Readonly<Record<string, unknown>>;
        parsed[entityId(rawEntityId)] = parsedEntity;
    }

    return parsed;
}

// ─── engine:tick ──────────────────────────────────────────────────────────────

/**
 * Stub `ActionDefinition` for `engine:tick`.
 *
 * Advances the simulation clock by one tick. Payload must carry a `seed`
 * integer (the per-tick RNG seed). The reducer is a no-op stub for M1 —
 * full clock advancement belongs to F04 / F21.
 */
export const engineTickDefinition: ActionDefinition<EngineTickPayload> = {
    type: 'engine:tick',

    parsePayload(raw: Readonly<Record<string, unknown>>): EngineTickPayload {
        // Invariant #42: all arithmetic state fields must be integers. The seed
        // is the base for F04's DeterministicRng, so non-integer, NaN, Infinity,
        // and -Infinity values must be rejected at the boundary. Number.isInteger
        // returns false for all of them (and false for non-numbers generally).
        // -0 is accepted as an integer (Number.isInteger(-0) === true); it is
        // indistinguishable from 0 for downstream seeding purposes.
        if (!Number.isInteger(raw['seed'])) {
            throw new TypeError(
                'engine:tick payload must have an integer "seed" field; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }
        return { seed: raw['seed'] as number };
    },

    validate(_payload, _state, _playerId, _ctx): ValidationResult {
        return { ok: true };
    },

    reduce(
        state: Readonly<BaseGameSnapshot>,
        _payload: EngineTickPayload,
        playerId,
        ctx,
    ): BaseGameSnapshot {
        // ── Advance timers (§4.20, Invariant #55) ───────────────────────────────────────
        // TimerManager.advance() is called exactly once per outer engine:tick
        // and is the ONLY caller of advance() (Invariant #55).
        // state.timers is guaranteed non-undefined by SaveMigrator v2→v3 (Invariant #54).
        const orig = state.timers;
        const { next, fired } = TimerManager.advance(orig);

        // Early-return guards: preserve reference equality so the Stage-7
        // broadcast guard can skip viewer snapshots on no-op ticks.
        //
        // Fast path (O(1)): when advance() finds all timers inactive, it returns
        // next === orig (same registry reference). We can return immediately
        // without the O(n) key scan below (WARN-1 optimization).
        //
        // Slow path: when any timer is active, advance() always produces new
        // object references (Object.fromEntries + per-timer spread), so
        // next !== orig is guaranteed. No content scan needed.
        if (fired.length === 0 && next === orig) {
            return state;
        }

        let nextState: BaseGameSnapshot = { ...state, timers: next };

        // ── Dispatch fired timer actions (Stages 1–5; Stages 6+7 suppressed by depth guard) ──
        // New or cancelled timers created by child actions do NOT fire in this
        // tick — advance() was already called above and its result is fixed.
        if (isReduceContext(ctx) && ctx.dispatch !== undefined) {
            for (const firedAction of fired) {
                const envelope = {
                    type: firedAction.actionType,
                    playerId,
                    tick: nextState.tick,
                    payload: firedAction.payload,
                };
                try {
                    nextState = ctx.dispatch(nextState, envelope);
                } catch (err) {
                    if (err instanceof ActionUnauthorizedError) {
                        // Non-fatal: log and continue — outer tick must not abort.
                        ctx.logger?.warn('timer fired action rejected by validate()', {
                            timerId: firedAction.timerId,
                            actionType: firedAction.actionType,
                            reason: err.reason,
                        });
                    } else {
                        throw err;
                    }
                }
            }
        }

        return nextState;
    },
} satisfies ActionDefinition<EngineTickPayload>;

// ─── engine:end_turn ──────────────────────────────────────────────────────────

/**
 * `ActionDefinition` for `engine:end_turn`.
 *
 * Signals the end of the current player's turn.
 * When `turnClock` is configured, advances the active player in round-robin
 * insertion order and optionally overrides the next deadline.
 */
export const engineEndTurnDefinition: ActionDefinition<EngineEndTurnPayload> = {
    type: 'engine:end_turn',

    parsePayload(raw: Readonly<Record<string, unknown>>): EngineEndTurnPayload {
        if (raw['deadlineMs'] === undefined) {
            return {};
        }

        if (!Number.isInteger(raw['deadlineMs'])) {
            throw new TypeError(
                'engine:end_turn payload must have an integer "deadlineMs" field when provided; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }

        return { deadlineMs: raw['deadlineMs'] as number };
    },

    validate(_payload, state, playerId, _ctx): ValidationResult {
        if (state.turnClock !== undefined && playerId !== state.turnClock.activePlayerId) {
            return { ok: false, reason: 'not_active_player' };
        }
        // WARN-2: reject when activePlayerId has been removed from state.players.
        // indexOf would silently return -1 and reduce would pick players[0] instead.
        if (state.turnClock !== undefined && !(state.turnClock.activePlayerId in state.players)) {
            return { ok: false, reason: 'active_player_not_in_game' };
        }
        return { ok: true };
    },

    reduce(state: Readonly<BaseGameSnapshot>, payload: EngineEndTurnPayload): BaseGameSnapshot {
        if (state.turnClock === undefined) {
            return state;
        }

        const playerIds = Object.values(state.players).map((playerState) => playerState.id);
        if (playerIds.length === 0) {
            return state;
        }

        const currentIndex = playerIds.indexOf(state.turnClock.activePlayerId);
        // Defensive guard: activePlayerId is no longer in state.players.
        // validate() must reject before reaching here; this guard catches any
        // caller that bypasses the pipeline.
        if (currentIndex < 0) {
            return state;
        }

        const nextPlayerId = playerIds[(currentIndex + 1) % playerIds.length];
        if (nextPlayerId === undefined) {
            return state;
        }

        return {
            ...state,
            tick: state.tick + 1,
            turnNumber: state.turnNumber + 1,
            turnClock: {
                activePlayerId: nextPlayerId,
                deadlineMs: payload.deadlineMs ?? state.turnClock.deadlineMs,
            },
        };
    },
} satisfies ActionDefinition<EngineEndTurnPayload>;

// ─── engine:start_match ──────────────────────────────────────────────────────

/**
 * `ActionDefinition` for starting a hosted match from the lobby.
 *
 * The main-process lobby manager validates host/all-ready policy before
 * dispatching this action. The simulation-level guard still enforces host-only
 * authority and the reducer transitions via the normal ActionPipeline path.
 */
export const engineStartMatchDefinition: ActionDefinition<EngineStartMatchPayload> = {
    type: 'engine:start_match',

    parsePayload(raw: Readonly<Record<string, unknown>>): EngineStartMatchPayload {
        const rawPlayerIds = raw['playerIds'];
        if (!Array.isArray(rawPlayerIds) || rawPlayerIds.length === 0) {
            throw new TypeError(
                'engine:start_match payload must have a non-empty "playerIds" array; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }

        const parsed: PlayerId[] = [];
        for (const rawPlayerId of rawPlayerIds) {
            if (typeof rawPlayerId !== 'string' || rawPlayerId.length === 0) {
                throw new TypeError(
                    'engine:start_match payload playerIds must contain only non-empty strings; ' +
                        `received ${JSON.stringify(raw)}.`,
                );
            }
            parsed.push(playerId(rawPlayerId));
        }

        const rawFirstPlayerId = raw['firstPlayerId'];
        if (rawFirstPlayerId !== undefined && typeof rawFirstPlayerId !== 'string') {
            throw new TypeError(
                'engine:start_match payload "firstPlayerId" must be a non-empty string when present; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }
        if (rawFirstPlayerId === '') {
            throw new TypeError(
                'engine:start_match payload "firstPlayerId" must be a non-empty string when present; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }

        const firstPlayerId =
            rawFirstPlayerId === undefined ? undefined : playerId(rawFirstPlayerId);
        const initialEntities = parseInitialEntities(raw['initialEntities']);

        return {
            playerIds: parsed,
            ...(firstPlayerId !== undefined ? { firstPlayerId } : {}),
            ...(initialEntities !== undefined ? { initialEntities } : {}),
        };
    },

    validate(payload, state, dispatcherId): ValidationResult {
        if (state.hostPlayerId === undefined || dispatcherId !== state.hostPlayerId) {
            return { ok: false, reason: 'host_only' };
        }
        if (
            payload.firstPlayerId !== undefined &&
            !payload.playerIds.includes(payload.firstPlayerId)
        ) {
            return { ok: false, reason: 'first_player_not_in_match' };
        }
        return { ok: true };
    },

    reduce(state: Readonly<BaseGameSnapshot>, payload: EngineStartMatchPayload): BaseGameSnapshot {
        const nextPlayers: BaseGameSnapshot['players'] = { ...state.players };
        for (const pid of payload.playerIds) {
            nextPlayers[pid] = nextPlayers[pid] ?? { id: pid };
        }

        const firstPlayerId = payload.firstPlayerId ?? state.turnClock?.activePlayerId;
        const nextTurnClock =
            firstPlayerId === undefined
                ? undefined
                : {
                      activePlayerId: firstPlayerId,
                      deadlineMs: state.turnClock?.deadlineMs ?? DEFAULT_TURN_DEADLINE_MS,
                  };

        const nextState: BaseGameSnapshot = {
            ...state,
            tick: state.tick + 1,
            players: nextPlayers,
            entities: payload.initialEntities ?? state.entities,
            phase: gamePhase('ended'),
        };

        return nextTurnClock === undefined ? nextState : { ...nextState, turnClock: nextTurnClock };
    },
} satisfies ActionDefinition<EngineStartMatchPayload>;

// ─── engine:save ─────────────────────────────────────────────────────────────

/**
 * Stub `ActionDefinition` for `engine:save`.
 *
 * Signals the host to write the current simulation state to a save slot.
 * Only the host player may dispatch this action (invariant #25).
 * The reducer is a no-op stub — actual persistence is handled by SaveManager
 * in the main process after the action clears the pipeline.
 */
export const engineSaveDefinition: ActionDefinition<EngineSaveLoadPayload> = {
    type: 'engine:save',

    parsePayload(raw: Readonly<Record<string, unknown>>): EngineSaveLoadPayload {
        if (typeof raw['slotId'] !== 'string') {
            throw new TypeError(
                'engine:save payload must have a string "slotId" field; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }
        return { slotId: raw['slotId'] };
    },

    validate(
        _payload: EngineSaveLoadPayload,
        state: Readonly<BaseGameSnapshot>,
        playerId: string,
        _ctx,
    ): ValidationResult {
        if (state.hostPlayerId === undefined || playerId !== state.hostPlayerId) {
            return {
                ok: false,
                reason: 'engine:save may only be dispatched by the host player (invariant #25)',
            };
        }
        return { ok: true };
    },

    reduce(state: Readonly<BaseGameSnapshot>, _payload: EngineSaveLoadPayload): BaseGameSnapshot {
        // Stub: returns snapshot unchanged. Actual save is performed by SaveManager.
        return state;
    },
} satisfies ActionDefinition<EngineSaveLoadPayload>;

// ─── engine:load ──────────────────────────────────────────────────────────────

/**
 * Stub `ActionDefinition` for `engine:load`.
 *
 * Signals the host to replace the current simulation state from a save slot.
 * Only the host player may dispatch this action (invariant #25).
 * The reducer is a no-op stub — actual state replacement is handled by
 * SaveManager.restoreFromSave() in the main process.
 */
export const engineLoadDefinition: ActionDefinition<EngineSaveLoadPayload> = {
    type: 'engine:load',

    parsePayload(raw: Readonly<Record<string, unknown>>): EngineSaveLoadPayload {
        if (typeof raw['slotId'] !== 'string') {
            throw new TypeError(
                'engine:load payload must have a string "slotId" field; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }
        return { slotId: raw['slotId'] };
    },

    validate(
        _payload: EngineSaveLoadPayload,
        state: Readonly<BaseGameSnapshot>,
        playerId: string,
        _ctx,
    ): ValidationResult {
        if (state.hostPlayerId === undefined || playerId !== state.hostPlayerId) {
            return {
                ok: false,
                reason: 'engine:load may only be dispatched by the host player (invariant #25)',
            };
        }
        return { ok: true };
    },

    reduce(state: Readonly<BaseGameSnapshot>, _payload: EngineSaveLoadPayload): BaseGameSnapshot {
        // Stub: returns snapshot unchanged. Actual load is performed by SaveManager.
        return state;
    },
} satisfies ActionDefinition<EngineSaveLoadPayload>;

// ─── engine:undo ──────────────────────────────────────────────────────────────

/**
 * Stub `ActionDefinition` for `engine:undo`.
 *
 * Authorisation and reconstruction live entirely in Stage 3 of
 * `ActionPipeline` via `UndoContext.undoManager`. When `undoManager` is
 * present, the pipeline short-circuits and `validate`/`reduce` are never
 * called — `UndoNotAllowedError` flows out of the manager directly.
 *
 * The `validate`/`reduce` stubs below are reached only when no `undoManager`
 * is wired into `PipelineContext` (e.g. during early bring-up). They are
 * intentionally permissive no-ops to avoid duplicating Stage 3's policy.
 *
 * Invariant #7: undo enters the pipeline normally; there is no side-door path.
 */
export const engineUndoDefinition: ActionDefinition<EngineUndoRedoPayload> = {
    type: 'engine:undo',

    parsePayload(raw: Readonly<Record<string, unknown>>): EngineUndoRedoPayload {
        if (raw['steps'] === undefined) {
            return { steps: 1 };
        }
        if (!Number.isInteger(raw['steps']) || (raw['steps'] as number) <= 0) {
            throw new TypeError(
                'engine:undo payload "steps" must be a positive integer when present; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }
        return { steps: raw['steps'] as number };
    },

    validate(): ValidationResult {
        // Stage 3 owns undo authorisation when an `undoManager` is wired.
        // Without one, undo is a no-op (no history to consult) and we accept.
        return { ok: true };
    },

    reduce(state: Readonly<BaseGameSnapshot>, _payload: EngineUndoRedoPayload): BaseGameSnapshot {
        // Stub: returns snapshot unchanged. Full undo logic to be implemented later.
        return state;
    },
} satisfies ActionDefinition<EngineUndoRedoPayload>;

// ─── engine:redo ──────────────────────────────────────────────────────────────

/**
 * Stub `ActionDefinition` for `engine:redo`.
 *
 * Authorisation and reconstruction live entirely in Stage 3 of
 * `ActionPipeline` via `UndoContext.undoManager`. When `undoManager` is
 * present, the pipeline short-circuits and `validate`/`reduce` are never
 * called — `UndoNotAllowedError` flows out of the manager directly.
 *
 * The `validate`/`reduce` stubs below are reached only when no `undoManager`
 * is wired into `PipelineContext` (e.g. during early bring-up). They are
 * intentionally permissive no-ops to avoid duplicating Stage 3's policy.
 *
 * Invariant #7: redo enters the pipeline normally; there is no side-door path.
 */
export const engineRedoDefinition: ActionDefinition<EngineUndoRedoPayload> = {
    type: 'engine:redo',

    parsePayload(raw: Readonly<Record<string, unknown>>): EngineUndoRedoPayload {
        if (raw['steps'] === undefined) {
            return { steps: 1 };
        }
        if (!Number.isInteger(raw['steps']) || (raw['steps'] as number) <= 0) {
            throw new TypeError(
                'engine:redo payload "steps" must be a positive integer when present; ' +
                    `received ${JSON.stringify(raw)}.`,
            );
        }
        return { steps: raw['steps'] as number };
    },

    validate(): ValidationResult {
        // Stage 3 owns redo authorisation when an `undoManager` is wired.
        // Without one, redo is a no-op (no history to consult) and we accept.
        return { ok: true };
    },

    reduce(state: Readonly<BaseGameSnapshot>, _payload: EngineUndoRedoPayload): BaseGameSnapshot {
        // Stub: returns snapshot unchanged. Full redo logic to be implemented later.
        return state;
    },
} satisfies ActionDefinition<EngineUndoRedoPayload>;

// ─── engine:sync_request ──────────────────────────────────────────────────────

/**
 * Stub `ActionDefinition` for `engine:sync_request`.
 *
 * Requests a full state snapshot from the host. No payload fields required.
 * Both `validate` and `reduce` are no-op stubs.
 */
export const engineSyncRequestDefinition: ActionDefinition<EngineSyncRequestPayload> = {
    type: 'engine:sync_request',

    parsePayload(_raw: Readonly<Record<string, unknown>>): EngineSyncRequestPayload {
        return {};
    },

    validate(_payload, _state, _playerId, _ctx): ValidationResult {
        return { ok: true };
    },

    reduce(
        state: Readonly<BaseGameSnapshot>,
        _payload: EngineSyncRequestPayload,
    ): BaseGameSnapshot {
        // Stub: returns snapshot unchanged.
        return state;
    },
} satisfies ActionDefinition<EngineSyncRequestPayload>;

// ─── EngineActions ────────────────────────────────────────────────────────────

/**
 * The complete set of M1/M3-required engine-reserved action definitions.
 *
 * This array is the single source of truth for which `engine:` action types
 * are registered at engine initialisation. Add new engine action definitions
 * here — never register them ad-hoc from outside this module.
 *
 * INVARIANT: Only `registerEngineActions()` (below) may iterate this array and
 * call `registry.registerEngineAction()`. Game code and renderer code must
 * never touch this path.
 */
export const EngineActions: readonly ActionDefinition<object>[] = [
    engineTickDefinition,
    engineEndTurnDefinition,
    engineStartMatchDefinition,
    engineSaveDefinition,
    engineLoadDefinition,
    engineUndoDefinition,
    engineRedoDefinition,
    engineSyncRequestDefinition,
] as const;

// ─── registerEngineActions ────────────────────────────────────────────────────

/**
 * Registers all engine-reserved action definitions into the given `ActionRegistry`.
 *
 * Must be called once per registry instance during engine initialisation,
 * before the game registers its own actions and before the tick loop starts.
 * Calling it twice on the same registry is safe (last write wins — same as
 * any other registration).
 *
 * This is the ONLY caller of `registry.registerEngineAction()`. Game code
 * and renderer code must never call `registerEngineAction()` directly.
 *
 * Generic over `TState extends BaseGameSnapshot` so that a concrete-snapshot
 * registry (e.g. `ActionRegistry<TacticsSnapshot>`) can be passed without a
 * cast at the call site (issue #38, §4.7).
 *
 * @param registry - The `ActionRegistry` instance to populate.
 */
export function registerEngineActions<TState extends BaseGameSnapshot>(
    registry: ActionRegistry<TState>,
): void {
    for (const definition of EngineActions) {
        // @chimera-review: engine stubs operate only on BaseGameSnapshot fields and return state
        // unchanged — safe to widen to ActionRegistry<TState extends BaseGameSnapshot>; cast
        // localised here so no call site requires an unsafe assertion. §4.7 / invariant #2.
        registry.registerEngineAction(definition as unknown as ActionDefinition<object, TState>);
    }
}
