import type { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import {
    TACTICS_DEFAULT_UNIT_ID_VALUE,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera/shared/tactics.js';
import type {
    ActionDefinition,
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
    PlayerId,
    ValidationResult,
} from '@chimera/simulation/engine/types.js';
import { entityId } from '@chimera/simulation/engine/types.js';
import { buildInitialTacticsEntities } from './entities.js';

export { TACTICS_MOVE_UNIT_ACTION };

/**
 * Canonical entity ID for the default unit seeded in the initial game snapshot.
 * Used in electron/main to build the initial hosted session snapshot.
 */
export const TACTICS_DEFAULT_UNIT_ID = entityId(TACTICS_DEFAULT_UNIT_ID_VALUE);

export type TacticsGridCoordinate = number & { readonly __brand: 'TacticsGridCoordinate' };

export function tacticsGridCoordinate(raw: number): TacticsGridCoordinate {
    if (!Number.isInteger(raw)) {
        throw new TypeError('tactics coordinates must be integers.');
    }
    return raw as TacticsGridCoordinate;
}

export interface TacticsMoveUnitPayload {
    readonly unitId: EntityId;
    readonly x: TacticsGridCoordinate;
    readonly y: TacticsGridCoordinate;
}

interface TacticsUnitEntity extends BaseEntityState {
    readonly kind: 'unit';
    readonly ownerId: PlayerId;
    readonly x: TacticsGridCoordinate;
    readonly y: TacticsGridCoordinate;
}

function isTacticsUnitEntity(entity: BaseEntityState | undefined): entity is TacticsUnitEntity {
    if (entity === undefined) {
        return false;
    }
    const candidate = entity as {
        readonly kind?: unknown;
        readonly ownerId?: unknown;
        readonly x?: unknown;
        readonly y?: unknown;
    };
    return (
        candidate.kind === 'unit' &&
        typeof candidate.ownerId === 'string' &&
        Number.isInteger(candidate.x) &&
        Number.isInteger(candidate.y)
    );
}

export const tacticsMoveUnitDefinition: ActionDefinition<TacticsMoveUnitPayload, BaseGameSnapshot> =
    {
        type: TACTICS_MOVE_UNIT_ACTION,
        predictable: true,

        parsePayload(raw: Readonly<Record<string, unknown>>): TacticsMoveUnitPayload {
            const unitId = raw['unitId'];
            const x = raw['x'];
            const y = raw['y'];
            if (typeof unitId !== 'string' || unitId.length === 0) {
                throw new TypeError('tactics:move_unit payload must include a non-empty unitId.');
            }
            if (
                typeof x !== 'number' ||
                typeof y !== 'number' ||
                !Number.isInteger(x) ||
                !Number.isInteger(y)
            ) {
                throw new TypeError('tactics:move_unit payload x and y must be integers.');
            }
            return {
                unitId: entityId(unitId),
                x: tacticsGridCoordinate(x),
                y: tacticsGridCoordinate(y),
            };
        },

        validate(payload, state, playerId): ValidationResult {
            const unit = state.entities[payload.unitId];
            if (!isTacticsUnitEntity(unit)) {
                return { ok: false, reason: 'unit_not_found' };
            }
            if (unit.ownerId !== playerId) {
                return { ok: false, reason: 'not_unit_owner' };
            }
            return { ok: true };
        },

        reduce(state, payload): BaseGameSnapshot {
            const unit = state.entities[payload.unitId];
            if (!isTacticsUnitEntity(unit)) {
                return state;
            }

            return {
                ...state,
                tick: state.tick + 1,
                entities: {
                    ...state.entities,
                    [payload.unitId]: {
                        ...unit,
                        x: payload.x,
                        y: payload.y,
                    },
                },
                events: [...state.events, { type: TACTICS_MOVE_UNIT_ACTION }],
            };
        },
    };

export function registerTacticsActions(registry: ActionRegistry<BaseGameSnapshot>): void {
    registry.register(tacticsMoveUnitDefinition);
    registry.registerGame('tactics', {
        buildInitialEntities: buildInitialTacticsEntities,
    });
}
