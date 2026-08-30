// The action app's initial entity set: three movable primitives and the arena
// ground plane they move on.
//
// Module boundary: game-core (no renderer/electron imports). Pure — the same
// roster always produces the same record (Invariant #43).

import type {
    BaseEntityState,
    EntityId,
    GameSetupConfig,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { entityId } from '@chimera-engine/simulation/engine/types.js';

import {
    ACTION_ARENA_DEPTH_CELLS,
    ACTION_ARENA_WIDTH_CELLS,
    ACTION_GROUND_ENTITY_ID_VALUE,
    ACTION_PRIMITIVE_SEEDS,
} from './constants.js';
import type { ActionGroundEntity, ActionPrimitiveEntity } from './action-types.js';

/** The ground plane's branded id — the renderer reads it off the snapshot. */
export const ACTION_GROUND_ENTITY_ID: EntityId = entityId(ACTION_GROUND_ENTITY_ID_VALUE);

/**
 * Builds the initial entity set for an action match.
 *
 * Seat N drives the Nth seeded primitive; a shorter roster leaves the remaining
 * primitives unclaimed (`ownerId: null`) and stationary until a seat selects
 * one through `action:select-primitive`.
 *
 * @param playerIds Seats in insertion order.
 * @param _setup Host-authored lobby setup, accepted for forward-compatibility;
 *   the seeded layout derives purely from the seat index, so it is unused.
 * @throws when `playerIds` is longer than {@link ACTION_PRIMITIVE_SEEDS} —
 *   loudly, rather than silently seating two players on one primitive.
 */
export function buildInitialActionEntities(
    playerIds: readonly PlayerId[],
    _setup?: GameSetupConfig,
): Record<EntityId, BaseEntityState> {
    if (playerIds.length > ACTION_PRIMITIVE_SEEDS.length) {
        throw new Error(
            `buildInitialActionEntities: roster of ${playerIds.length.toString()} players ` +
                `exceeds ${ACTION_PRIMITIVE_SEEDS.length.toString()} available primitives`,
        );
    }

    const entities: Record<EntityId, BaseEntityState> = {};

    const ground: ActionGroundEntity = {
        id: ACTION_GROUND_ENTITY_ID,
        kind: 'ground',
        widthCells: ACTION_ARENA_WIDTH_CELLS,
        depthCells: ACTION_ARENA_DEPTH_CELLS,
    };
    entities[ground.id] = ground;

    for (let index = 0; index < ACTION_PRIMITIVE_SEEDS.length; index += 1) {
        const seed = ACTION_PRIMITIVE_SEEDS[index];
        // Unreachable — the loop is bounded by the array's own length. Kept as a
        // throw rather than a `continue` so a future seed list built some other
        // way cannot silently drop a primitive.
        if (seed === undefined) {
            throw new Error(`buildInitialActionEntities: no seed at index ${index.toString()}`);
        }

        const primitive: ActionPrimitiveEntity = {
            id: entityId(seed.id),
            kind: 'primitive',
            shape: seed.shape,
            x: seed.x,
            y: seed.y,
            dx: 0,
            dy: 0,
            ownerId: playerIds[index] ?? null,
        };
        entities[primitive.id] = primitive;
    }

    return entities;
}
