// Runtime narrowing for the action app's two entity kinds.
//
// Both guards check every field their kind ADDS to `BaseEntityState`, not just
// the `kind` discriminant: an entity record reaches a reducer from a save file
// or a wire snapshot, so `kind === 'primitive'` alone is a claim about untrusted
// data. The inherited `id` is not re-checked — it is the record's own key.
// The renderer reuses the SAME guards through the app's scoped subpath, so the
// screen and the reducers agree on what counts as a primitive.
//
// Module boundary: game-core (only `@chimera-engine/simulation` types).

import type { BaseEntityState } from '@chimera-engine/simulation/engine/types.js';

import { ACTION_PRIMITIVE_SHAPES } from './constants.js';
import type { ActionGroundEntity, ActionPrimitiveEntity } from './action-types.js';

function isVelocityComponent(value: unknown): boolean {
    return value === -1 || value === 0 || value === 1;
}

/** True when `entity` is a fully-formed movable primitive. */
export function isActionPrimitiveEntity(
    entity: BaseEntityState | undefined,
): entity is ActionPrimitiveEntity {
    if (entity === undefined) return false;
    const candidate = entity as {
        readonly kind?: unknown;
        readonly shape?: unknown;
        readonly x?: unknown;
        readonly y?: unknown;
        readonly dx?: unknown;
        readonly dy?: unknown;
        readonly ownerId?: unknown;
    };
    return (
        candidate.kind === 'primitive' &&
        ACTION_PRIMITIVE_SHAPES.includes(
            candidate.shape as (typeof ACTION_PRIMITIVE_SHAPES)[number],
        ) &&
        Number.isInteger(candidate.x) &&
        Number.isInteger(candidate.y) &&
        isVelocityComponent(candidate.dx) &&
        isVelocityComponent(candidate.dy) &&
        (candidate.ownerId === null || typeof candidate.ownerId === 'string')
    );
}

/** True when `entity` is the arena's ground plane. */
export function isActionGroundEntity(
    entity: BaseEntityState | undefined,
): entity is ActionGroundEntity {
    if (entity === undefined) return false;
    const candidate = entity as {
        readonly kind?: unknown;
        readonly widthCells?: unknown;
        readonly depthCells?: unknown;
    };
    return (
        candidate.kind === 'ground' &&
        Number.isInteger(candidate.widthCells) &&
        Number.isInteger(candidate.depthCells)
    );
}
