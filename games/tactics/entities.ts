import type { BaseEntityState, EntityId, PlayerId } from '@chimera/simulation/engine/types.js';
import { TACTICS_DEFAULT_UNIT_ID, tacticsGridCoordinate } from './actions.js';

export function buildInitialTacticsEntities(
    firstPlayer: PlayerId | undefined,
): Record<EntityId, BaseEntityState> {
    if (firstPlayer === undefined) {
        return {};
    }

    const tacticsUnit = {
        id: TACTICS_DEFAULT_UNIT_ID,
        kind: 'unit',
        ownerId: firstPlayer,
        x: tacticsGridCoordinate(0),
        y: tacticsGridCoordinate(0),
    } satisfies BaseEntityState & {
        readonly kind: 'unit';
        readonly ownerId: PlayerId;
        readonly x: ReturnType<typeof tacticsGridCoordinate>;
        readonly y: ReturnType<typeof tacticsGridCoordinate>;
    };

    return {
        [TACTICS_DEFAULT_UNIT_ID]: tacticsUnit,
    };
}
