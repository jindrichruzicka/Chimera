// The action app's initial entity set: three movable primitives and the arena
// ground plane they move on.
//
// Module boundary: game-core (no renderer/electron imports). Pure — see
// `assignActionPrimitiveOwners` below for what determinism means here
// (Invariant #43).

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
    ACTION_PRIMITIVE_ATTRIBUTE,
    ACTION_PRIMITIVE_SEEDS,
    isActionPrimitiveShape,
} from './constants.js';
import type { ActionGroundEntity, ActionPrimitiveEntity } from './action-types.js';

/** The ground plane's branded id — the renderer reads it off the snapshot. */
export const ACTION_GROUND_ENTITY_ID: EntityId = entityId(ACTION_GROUND_ENTITY_ID_VALUE);

/**
 * Builds the initial entity set for an action match.
 *
 * Which primitive a seat drives is {@link assignActionPrimitiveOwners}'; a
 * primitive no seat took stays unclaimed (`ownerId: null`) and stationary until
 * one selects it through `action:select-primitive`.
 *
 * @param playerIds Seats in insertion order.
 * @param setup Synced lobby setup. Its `playerAttributes` carry each seat's
 *   `primitive` pick — written by the shell's `/select` page onto the quick-start
 *   draft, or by a lobby — which is what decides the seating.
 * @throws when `playerIds` is longer than {@link ACTION_PRIMITIVE_SEEDS} —
 *   loudly, rather than silently seating two players on one primitive.
 */
export function buildInitialActionEntities(
    playerIds: readonly PlayerId[],
    setup?: GameSetupConfig,
): Record<EntityId, BaseEntityState> {
    if (playerIds.length > ACTION_PRIMITIVE_SEEDS.length) {
        throw new Error(
            `buildInitialActionEntities: roster of ${playerIds.length.toString()} players ` +
                `exceeds ${ACTION_PRIMITIVE_SEEDS.length.toString()} available primitives`,
        );
    }

    const owners = assignActionPrimitiveOwners(playerIds, setup);
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
            ownerId: owners[index] ?? null,
        };
        entities[primitive.id] = primitive;
    }

    return entities;
}

/**
 * Which seat drives each seeded primitive, indexed alongside
 * {@link ACTION_PRIMITIVE_SEEDS}.
 *
 * Two passes, and the order between them is the whole rule. The first honours
 * the `primitive` pick of every seat that made one and can still have it; the
 * second fills whatever is left in seat order. Running the fallback per seat
 * inside ONE pass would let an early seat with no pick consume the seed a later
 * seat named, so a player who chose the cone would watch someone else drive it.
 *
 * Total and deterministic: an unreadable pick, a shape another seat already
 * holds, and a roster shorter than the seed list all resolve without throwing,
 * because this runs inside the host's match construction and a malformed
 * attribute must not be able to fail a start (Invariant #43 — same roster and
 * setup, same record).
 */
export function assignActionPrimitiveOwners(
    playerIds: readonly PlayerId[],
    setup?: GameSetupConfig,
): readonly (PlayerId | null)[] {
    const owners: (PlayerId | null)[] = ACTION_PRIMITIVE_SEEDS.map(() => null);
    const seated = new Set<PlayerId>();

    for (const player of playerIds) {
        const primitive = setup?.playerAttributes[player]?.[ACTION_PRIMITIVE_ATTRIBUTE];
        if (!isActionPrimitiveShape(primitive)) {
            continue;
        }
        const index = ACTION_PRIMITIVE_SEEDS.findIndex((seed) => seed.shape === primitive);
        if (index === -1 || owners[index] !== null) {
            continue;
        }
        owners[index] = player;
        seated.add(player);
    }

    for (const player of playerIds) {
        if (seated.has(player)) {
            continue;
        }
        const index = owners.indexOf(null);
        if (index === -1) {
            break;
        }
        owners[index] = player;
        seated.add(player);
    }

    return owners;
}
