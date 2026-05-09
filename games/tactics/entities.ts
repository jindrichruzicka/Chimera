import type { BaseEntityState, EntityId, PlayerId } from '@chimera/simulation/engine/types.js';
import { entityId } from '@chimera/simulation/engine/types.js';
import { tacticsGridCoordinate } from './actions.js';
import { TACTICS_DEFAULT_UNIT_ID_VALUE } from '@chimera/shared/tactics.js';

export function buildInitialTacticsEntities(
    playerIds: readonly PlayerId[],
): Record<EntityId, BaseEntityState> {
    const entities: Record<EntityId, BaseEntityState> = {};

    // Create one movable unit per player in insertion order
    for (let index = 0; index < playerIds.length; index += 1) {
        const playerId = playerIds[index];
        if (playerId === undefined) continue;

        // Use the default unit ID for the first player, then generate unique IDs for others
        const unitIdValue = index === 0 ? TACTICS_DEFAULT_UNIT_ID_VALUE : `unit-${index + 1}`;
        const unitId = entityId(unitIdValue);

        const tacticsUnit = {
            id: unitId,
            kind: 'unit',
            ownerId: playerId,
            x: tacticsGridCoordinate(index),
            y: tacticsGridCoordinate(0),
        } satisfies BaseEntityState & {
            readonly kind: 'unit';
            readonly ownerId: PlayerId;
            readonly x: ReturnType<typeof tacticsGridCoordinate>;
            readonly y: ReturnType<typeof tacticsGridCoordinate>;
        };

        entities[unitId] = tacticsUnit;
    }

    return entities;
}
