/**
 * simulation/engine/EngineActions.ts
 *
 * Reserved engine action definitions for the Chimera simulation core.
 *
 * Defines `ActionDefinition` entries for the four M1-required engine-reserved
 * action types: `engine:tick`, `engine:end_turn`, `engine:save`, and
 * `engine:load`. These are the only callers of the engine-internal
 * `registerEngineAction()` bypass on `ActionRegistry`.
 *
 * Architecture reference: §4.2, §4.7
 * Task: F03 / T4 (issue #27)
 *
 * Invariants upheld:
 *   #2 — Engine reserved actions are the only mechanism for cross-cutting
 *         tick/turn lifecycle mutations. EngineActions is the sole caller of
 *         ActionRegistry.registerEngineAction().
 *   #3 — simulation/ is side-effect-free; no Node.js or Electron imports.
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
 * No payload fields required — the acting player is identified by the envelope.
 */
export type EngineEndTurnPayload = Record<string, never>;

/**
 * Payload for `engine:save` and `engine:load`.
 * `slotId` is the qualified slot identifier `'<gameId>/<slotName>'`.
 */
export type EngineSaveLoadPayload = Record<string, unknown> & {
    readonly slotId: string;
};

// ─── engine:tick ──────────────────────────────────────────────────────────────

/**
 * Stub `ActionDefinition` for `engine:tick`.
 *
 * Advances the simulation clock by one tick. Payload must carry a `seed`
 * integer (the per-tick RNG seed). The reducer is a no-op stub for M1 —
 * full clock advancement belongs to F04 / F21.
 */
const engineTickDefinition: ActionDefinition<EngineTickPayload> = {
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
 * Stub `ActionDefinition` for `engine:end_turn`.
 *
 * Signals the end of the current player's turn. No payload fields required.
 * The reducer is a no-op stub for M1 — full turn-advance logic belongs to F15.
 */
const engineEndTurnDefinition: ActionDefinition<EngineEndTurnPayload> = {
    type: 'engine:end_turn',

    parsePayload(_raw: Readonly<Record<string, unknown>>): EngineEndTurnPayload {
        return {};
    },

    validate(_payload, _state, _playerId, _ctx): ValidationResult {
        return { ok: true };
    },

    reduce(state: Readonly<BaseGameSnapshot>, _payload: EngineEndTurnPayload): BaseGameSnapshot {
        // Stub: returns snapshot unchanged. Full turn-advance logic lands in F15.
        return state;
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
const engineSaveDefinition: ActionDefinition<EngineSaveLoadPayload> = {
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
const engineLoadDefinition: ActionDefinition<EngineSaveLoadPayload> = {
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
        return state;
    },
} satisfies ActionDefinition<EngineSaveLoadPayload>;

// ─── EngineActions ────────────────────────────────────────────────────────────

/**
 * The complete set of M1-required engine-reserved action definitions.
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
