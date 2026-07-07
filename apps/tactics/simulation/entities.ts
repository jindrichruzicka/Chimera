import type {
    BaseEntityState,
    EntityId,
    GameSetupConfig,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { entityId } from '@chimera-engine/simulation/engine/types.js';
import { tacticsGridCoordinate } from './actions.js';
import { TACTICS_DEFAULT_UNIT_ID_VALUE, TACTICS_START_POSITIONS } from './constants.js';

/**
 * Builds the initial entity set for a tactics match — one movable unit per
 * player, placed on its deterministic per-seat start position.
 *
 * Precondition: `playerIds.length <= TACTICS_START_POSITIONS.length` (4). The
 * lobby enforces `maxPlayers: 4`, so this holds for every real match; the
 * builder throws on a longer roster rather than silently colliding two seats
 * onto one cell.
 *
 * @param playerIds Seats in insertion order; each gets the start position at its
 *   index.
 * @param _setup Host-authored lobby setup (#702-T3) accepted for
 *   forward-compatibility; start positions derive purely from the seat index, so
 *   it is unused here.
 * @throws if `playerIds.length` exceeds the number of available start positions.
 */
export function buildInitialTacticsEntities(
    playerIds: readonly PlayerId[],
    _setup?: GameSetupConfig,
): Record<EntityId, BaseEntityState> {
    if (playerIds.length > TACTICS_START_POSITIONS.length) {
        throw new Error(
            `buildInitialTacticsEntities: roster of ${playerIds.length} players exceeds ` +
                `${TACTICS_START_POSITIONS.length} available start positions`,
        );
    }

    const entities: Record<EntityId, BaseEntityState> = {};

    // Create one movable unit per player in insertion order
    for (let index = 0; index < playerIds.length; index += 1) {
        const playerId = playerIds[index];
        if (playerId === undefined) continue;

        // Deterministic per-seat start position. The roster length is guarded
        // above, so the index is always in range; the undefined branch is
        // unreachable and exists only to satisfy strict index typing. Assert
        // loudly rather than silently colliding seats onto (0,0) if the guard
        // and TACTICS_START_POSITIONS ever diverge.
        const start = TACTICS_START_POSITIONS[index];
        if (start === undefined) {
            throw new Error(
                `buildInitialTacticsEntities: no start position for seat index ${index}`,
            );
        }

        // Use the default unit ID for the first player, then generate unique IDs for others
        const unitIdValue = index === 0 ? TACTICS_DEFAULT_UNIT_ID_VALUE : `unit-${index + 1}`;
        const unitId = entityId(unitIdValue);

        const tacticsUnit = {
            id: unitId,
            kind: 'unit',
            ownerId: playerId,
            x: tacticsGridCoordinate(start.x),
            y: tacticsGridCoordinate(start.y),
            hp: 1,
            visibleTo: [playerId],
        } satisfies BaseEntityState & {
            readonly kind: 'unit';
            readonly ownerId: PlayerId;
            readonly x: ReturnType<typeof tacticsGridCoordinate>;
            readonly y: ReturnType<typeof tacticsGridCoordinate>;
            readonly hp: number;
            readonly visibleTo: readonly PlayerId[];
        };

        entities[unitId] = tacticsUnit;
    }

    return entities;
}
