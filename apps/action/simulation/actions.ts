// The action app's action registry, reducers and per-beat movement pass. The
// host calls `registerActionActions` once at startup to register this game's
// reducers and lifecycle hooks into the shared engine `ActionRegistry`.
//
// Module boundary: game-core — only `@chimera-engine/simulation` and own
// modules (relative), never renderer, electron or networking.
//
// THE CLOCK. This is the engine's first realtime consumer: the manifest sets
// `realtime: true`, so the host's `RealtimeTicker` dispatches `engine:tick` on
// a wall-clock heartbeat and `engine:tick` runs {@link advanceActionPrimitives}
// as the game's per-beat hook. Nothing in this module reads a clock — the beat
// arrives as an ordinary reduce, so the same recorded actions replay to the same
// state (Invariants #43/#70).
//
// Each reducer below advances `tick` whenever it returns a CHANGED snapshot
// (Invariant #42) — that is what makes its recorded action replayable. Its
// no-op arms return the input reference instead, and `validate` refuses each
// of them; the arm tests in `actions.test.ts` measure both halves. The
// per-beat hook advances nothing either: it runs inside `engine:tick`'s own
// reduce, which has already advanced.

import type { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import type { ClosedAnimationWindow } from '@chimera-engine/simulation/engine/AnimationWindow.js';
import type {
    ActionDefinition,
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
    GameReduceContext,
    PlayerId,
    ValidationResult,
} from '@chimera-engine/simulation/engine/types.js';

import {
    ACTION_GAME_ID,
    ACTION_SELECT_PRIMITIVE_ACTION,
    ACTION_SET_VELOCITY_ACTION,
    clampToArenaX,
    clampToArenaY,
} from './constants.js';
import {
    ActionSelectPrimitivePayloadSchema,
    ActionSetVelocityPayloadSchema,
} from './action-schemas.js';
import type {
    ActionPrimitiveEntity,
    ActionSelectPrimitivePayload,
    ActionSetVelocityPayload,
} from './action-types.js';
import { buildInitialActionEntities } from './entities.js';
import { isActionPrimitiveEntity } from './entity-guards.js';

// Re-export the payload types so consumers import one module rather than three.
export type {
    ActionSelectPrimitivePayload,
    ActionSetVelocityPayload,
    ActionVelocityComponent,
} from './action-types.js';
export { ACTION_SELECT_PRIMITIVE_ACTION, ACTION_SET_VELOCITY_ACTION };

/** The primitive `playerId` drives, or `undefined` when the seat drives none. */
function findControlledPrimitive(
    entities: Readonly<Record<EntityId, BaseEntityState>>,
    playerId: PlayerId,
): ActionPrimitiveEntity | undefined {
    for (const entity of Object.values(entities)) {
        if (isActionPrimitiveEntity(entity) && entity.ownerId === playerId) {
            return entity;
        }
    }
    return undefined;
}

// ── action:set-velocity ──────────────────────────────────────────────────────

/**
 * Points the acting seat's primitive in a direction. The write is a velocity,
 * never a position: the movement itself happens once per beat in
 * {@link advanceActionPrimitives}, so holding a key produces steady motion at
 * the heartbeat rate instead of one action per rendered frame.
 */
export const actionSetVelocityDefinition: ActionDefinition<
    ActionSetVelocityPayload,
    BaseGameSnapshot
> = {
    type: ACTION_SET_VELOCITY_ACTION,

    parsePayload(raw): ActionSetVelocityPayload {
        return ActionSetVelocityPayloadSchema.parse(raw);
    },

    validate(_payload, state, playerId): ValidationResult {
        if (findControlledPrimitive(state.entities, playerId) === undefined) {
            return { ok: false, reason: 'no_controlled_primitive' };
        }
        return { ok: true };
    },

    reduce(state, payload, playerId): BaseGameSnapshot {
        const controlled = findControlledPrimitive(state.entities, playerId);
        // `validate` has already refused this, but `reduce` must be total: an
        // engine path that reduced without validating would otherwise throw.
        if (controlled === undefined) return state;

        const next: ActionPrimitiveEntity = {
            ...controlled,
            dx: payload.dx,
            dy: payload.dy,
        };
        return {
            ...state,
            tick: state.tick + 1,
            entities: { ...state.entities, [controlled.id]: next },
        };
    },
};

// ── action:select-primitive ──────────────────────────────────────────────────

/**
 * Claims a primitive for the acting seat. Selection is EXCLUSIVE and expressed
 * as ownership on the entity itself rather than as a per-player field, so the
 * two-player variant needs no second source of truth about who drives what:
 * whoever a primitive's `ownerId` names is the seat whose `set-velocity` moves
 * it, and the renderer reads the same field to draw the selection.
 */
export const actionSelectPrimitiveDefinition: ActionDefinition<
    ActionSelectPrimitivePayload,
    BaseGameSnapshot
> = {
    type: ACTION_SELECT_PRIMITIVE_ACTION,

    parsePayload(raw): ActionSelectPrimitivePayload {
        return ActionSelectPrimitivePayloadSchema.parse(raw);
    },

    validate(payload, state, playerId): ValidationResult {
        const target = state.entities[payload.entityId as EntityId];
        if (target === undefined) {
            return { ok: false, reason: 'unknown_entity' };
        }
        if (!isActionPrimitiveEntity(target)) {
            // The ground plane shares the entity record, so existence alone is
            // not enough to say a seat may drive it.
            return { ok: false, reason: 'not_a_primitive' };
        }
        if (target.ownerId === playerId) {
            // A click on the primitive the seat already drives changes nothing,
            // and `reduce` returns the input reference for it. Refusing keeps
            // it off the path to `HostSessionPipeline.processAction`, which is
            // where an applied action meets the replay recorder — and an entry
            // that leaves the tick where it was is one `ReplayPlayer.step()`
            // refuses (Invariant #42).
            return { ok: false, reason: 'already_controlled' };
        }
        if (target.ownerId !== null) {
            return { ok: false, reason: 'primitive_taken' };
        }
        return { ok: true };
    },

    reduce(state, payload, playerId): BaseGameSnapshot {
        const target = state.entities[payload.entityId as EntityId];
        // Both arms are refused by `validate`, but `reduce` must be total for
        // an engine path that reduced without validating.
        if (!isActionPrimitiveEntity(target)) return state;
        if (target.ownerId === playerId) return state;

        const entities: Record<EntityId, BaseEntityState> = { ...state.entities };

        // Release whatever the seat was driving, and STOP it: a released
        // primitive that kept its velocity would coast on with nobody at the
        // controls, and nothing would ever stop it again.
        const previous = findControlledPrimitive(state.entities, playerId);
        if (previous !== undefined) {
            const released: ActionPrimitiveEntity = {
                ...previous,
                ownerId: null,
                dx: 0,
                dy: 0,
            };
            entities[previous.id] = released;
        }

        const claimed: ActionPrimitiveEntity = { ...target, ownerId: playerId };
        entities[target.id] = claimed;
        return { ...state, tick: state.tick + 1, entities };
    },
};

// ── The per-beat movement pass ───────────────────────────────────────────────

/**
 * Advances every primitive by its own velocity, one arena cell per axis, and
 * clamps the result into the arena. Registered as the game's `onBeat` hook, so
 * `engine:tick` runs it exactly once per heartbeat.
 *
 * The two axes clamp INDEPENDENTLY: a primitive pressed into the east wall
 * keeps sliding north. Velocity is preserved through a clamp, so a player
 * holding a key against a wall starts moving again the moment the other axis
 * carries them off it, without re-pressing.
 *
 * Pure: no clock, no RNG, no dispatch (Invariants #43/#89). Returns the input
 * reference unchanged when nothing moved.
 */
export function advanceActionPrimitives(
    state: BaseGameSnapshot,
    _ctx: GameReduceContext,
    _closed: readonly ClosedAnimationWindow[],
): BaseGameSnapshot {
    let moved = false;
    const entities: Record<EntityId, BaseEntityState> = { ...state.entities };

    for (const entity of Object.values(state.entities)) {
        if (!isActionPrimitiveEntity(entity)) continue;
        if (entity.dx === 0 && entity.dy === 0) continue;

        const x = clampToArenaX(entity.x + entity.dx);
        const y = clampToArenaY(entity.y + entity.dy);
        if (x === entity.x && y === entity.y) continue;

        const advanced: ActionPrimitiveEntity = { ...entity, x, y };
        entities[entity.id] = advanced;
        moved = true;
    }

    return moved ? { ...state, entities } : state;
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Registers the action app's reducers and game definition. `resolveGameResult`
 * always returns `null`: this is a movement sandbox with no win condition, and
 * a match ends by the player leaving it rather than by resolving.
 */
export function registerActionActions(registry: ActionRegistry<BaseGameSnapshot>): void {
    registry.register(actionSetVelocityDefinition);
    registry.register(actionSelectPrimitiveDefinition);
    registry.registerGame(ACTION_GAME_ID, {
        buildInitialEntities: buildInitialActionEntities,
        resolveGameResult: () => null,
        onBeat: advanceActionPrimitives,
    });
}
