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

import type { ActionDefinition, BaseGameSnapshot, ValidationResult } from './types.js';
import type { ActionRegistry } from './ActionRegistry.js';

// ─── Payload types ────────────────────────────────────────────────────────────

/**
 * Payload for `engine:tick`.
 * `seed` is the per-tick RNG seed derived by the host at tick advance time.
 * All arithmetic fields are integers (invariant #42).
 *
 * Intersected with `Record<string, unknown>` so the type satisfies the
 * `TPayload extends Record<string, unknown>` constraint on `ActionDefinition`.
 */
export type EngineTickPayload = Record<string, unknown> & {
    readonly seed: number;
};

/**
 * Payload for `engine:end_turn`.
 * `deadlineMs` optionally overrides the next turn deadline using integer time.
 * The acting player is identified by the envelope.
 */
export type EngineEndTurnPayload = Record<string, unknown> & {
    readonly deadlineMs?: number;
};

/**
 * Payload for `engine:save` and `engine:load`.
 * `slotId` is the qualified slot identifier `'<gameId>/<slotName>'`.
 */
export type EngineSaveLoadPayload = Record<string, unknown> & {
    readonly slotId: string;
};

/**
 * Payload for `engine:undo` and `engine:redo`.
 * `steps` is the number of actions to undo/redo; defaults to 1 if absent.
 * Must be a positive integer when present (invariant #42).
 */
export type EngineUndoRedoPayload = Record<string, unknown> & {
    readonly steps: number;
};

/**
 * Payload for `engine:sync_request`.
 * No payload fields — requests a full state snapshot from the host.
 */
export type EngineSyncRequestPayload = Record<string, never>;

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

    reduce(state: Readonly<BaseGameSnapshot>, _payload: EngineTickPayload): BaseGameSnapshot {
        // Stub: returns snapshot unchanged. Full tick logic lands in F04 / F21.
        return state;
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
            turnClock: {
                activePlayerId: nextPlayerId,
                deadlineMs: payload.deadlineMs ?? state.turnClock.deadlineMs,
            },
        };
    },
} satisfies ActionDefinition<EngineEndTurnPayload>;

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
        if (state.hostPlayerId !== undefined && playerId !== state.hostPlayerId) {
            return {
                ok: false,
                reason: 'engine:save may only be dispatched by the host player (invariant #25)',
            };
        }
        return { ok: true };
    },

    reduce(state: Readonly<BaseGameSnapshot>, _payload: EngineSaveLoadPayload): BaseGameSnapshot {
        // Stub: returns snapshot unchanged. Actual save is performed by SaveManager.
        // TODO(F18): wire post-pipeline save/load side-effect handler
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
        if (state.hostPlayerId !== undefined && playerId !== state.hostPlayerId) {
            return {
                ok: false,
                reason: 'engine:load may only be dispatched by the host player (invariant #25)',
            };
        }
        return { ok: true };
    },

    reduce(state: Readonly<BaseGameSnapshot>, _payload: EngineSaveLoadPayload): BaseGameSnapshot {
        // Stub: returns snapshot unchanged. Actual load is performed by SaveManager.
        // TODO(F18): wire post-pipeline save/load side-effect handler
        return state;
    },
} satisfies ActionDefinition<EngineSaveLoadPayload>;

// ─── engine:undo ──────────────────────────────────────────────────────────────

/**
 * Stub `ActionDefinition` for `engine:undo`.
 *
 * Requests that the simulation rewind by `steps` actions (default: 1).
 * Both `validate` and `reduce` are no-op stubs for now — full undo logic
 * lands in a later milestone. Invariant #7: undo enters the pipeline
 * normally; there is no side-door undo path.
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

    validate(_payload, _state, playerId, ctx): ValidationResult {
        if (ctx.undoManager !== undefined && !ctx.undoManager.canUndo(playerId)) {
            return { ok: false, reason: 'undo_not_available' };
        }
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
 * Requests that the simulation reapply `steps` previously undone actions
 * (default: 1). Both `validate` and `reduce` are no-op stubs for now.
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

    validate(_payload, _state, playerId, ctx): ValidationResult {
        if (ctx.undoManager !== undefined && !ctx.undoManager.canRedo(playerId)) {
            return { ok: false, reason: 'redo_not_available' };
        }
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
export const EngineActions: readonly ActionDefinition<Record<string, unknown>>[] = [
    engineTickDefinition,
    engineEndTurnDefinition,
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
 * @param registry - The `ActionRegistry` instance to populate.
 */
export function registerEngineActions(registry: ActionRegistry): void {
    for (const definition of EngineActions) {
        registry.registerEngineAction(definition);
    }
}
