// The typed, opaque→fields projection the action playfield renders from.
//
// A `PlayerSnapshot` carries `ObservedEntityState` records — structurally
// opaque on the renderer side — so this module is the single place that narrows
// them, using the SAME guards the reducers use (`simulation/entity-guards.ts`).
// One definition of "is this a primitive" means a record the simulation would
// refuse can never reach the scene as a shape at NaN.
//
// Pure: no React, no r3f, no DOM. That is what lets every claim about the scene
// — ordering, world mapping, what a malformed record does — be a plain unit
// test rather than a canvas render.

import type { EntityId } from '@chimera-engine/simulation/engine/types.js';
import type { ObservedEntityState } from '@chimera-engine/simulation/projection/types.js';

import type { ActionPrimitiveShape } from '../simulation/constants.js';
import { isActionGroundEntity, isActionPrimitiveEntity } from '../simulation/entity-guards.js';

/**
 * How high above the floor a primitive's centre sits, in world units — half a
 * cell, so a unit-sized shape rests ON the ground plane rather than through it.
 *
 * It lives HERE, on the renderer side, and not beside the arena extents it is
 * derived from. A fraction is exactly what `simulation/` may not carry
 * (Invariants #44/#75 — the only sanctioned fractional representation there is
 * `FixedPoint`), and this quantity has no business being one: nothing in a
 * reducer reads it, and a primitive's arena cell is an integer either way.
 */
export const ACTION_PRIMITIVE_HEIGHT = 0.5;

/** A world-space position, in the tuple form r3f's `position` prop takes. */
export type ActionWorldPoint = readonly [number, number, number];

/** An arena cell, as the simulation stores it. */
export interface ActionGridPoint {
    readonly x: number;
    readonly y: number;
}

/** One primitive, ready to mount. */
export interface ActionScenePrimitive {
    readonly id: string;
    readonly shape: ActionPrimitiveShape;
    readonly grid: ActionGridPoint;
    readonly world: ActionWorldPoint;
    /** The seat driving it, or `null` while unclaimed. */
    readonly ownerId: string | null;
}

/** The arena floor, sized in cells. */
export interface ActionSceneGround {
    readonly widthCells: number;
    readonly depthCells: number;
}

export interface ActionScene {
    readonly primitives: readonly ActionScenePrimitive[];
    readonly ground: ActionSceneGround | null;
}

/**
 * Maps an arena cell onto the world XZ plane.
 *
 * Arena `y` becomes world `z` UNCHANGED. Under the engine's `top-down` camera
 * preset — positioned above the origin looking along -Y — screen-up is world
 * -Z, so an arena `y` that grows downward on screen is exactly what makes
 * `game:move-up` a `dy: -1` step (see `input-action-ids.ts`).
 */
export function arenaToWorld(grid: ActionGridPoint, height: number): ActionWorldPoint {
    return [grid.x, height, grid.y];
}

/**
 * Narrows a projected entity record into the scene the playfield mounts.
 *
 * Primitives come back sorted by id, so the mounted order is a property of the
 * scene rather than of whatever order the record happened to arrive in — two
 * snapshots describing the same arena mount the same list.
 */
export function parseActionScene(
    entities: Readonly<Record<EntityId, ObservedEntityState>>,
): ActionScene {
    const primitives: ActionScenePrimitive[] = [];
    let ground: ActionSceneGround | null = null;

    for (const entity of Object.values(entities)) {
        if (isActionPrimitiveEntity(entity)) {
            primitives.push({
                id: entity.id,
                shape: entity.shape,
                grid: { x: entity.x, y: entity.y },
                world: arenaToWorld({ x: entity.x, y: entity.y }, ACTION_PRIMITIVE_HEIGHT),
                ownerId: entity.ownerId,
            });
            continue;
        }
        if (isActionGroundEntity(entity)) {
            ground = { widthCells: entity.widthCells, depthCells: entity.depthCells };
        }
    }

    primitives.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

    return { primitives, ground };
}
