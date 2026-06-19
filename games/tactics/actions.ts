import type { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_DEFAULT_UNIT_ID_VALUE,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_PROXIMITY_REVEAL_RANGE_TILES_SQUARED,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera/tactics/constants.js';
import type {
    ActionDefinition,
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
    GameResult,
    PlayerId,
    ValidationResult,
} from '@chimera/simulation/engine/types.js';
import { entityId } from '@chimera/simulation/engine/types.js';
import { tacticsCommitDefinition } from './commitment/commitAction.js';
import {
    allSeatsCommitted,
    isTacticsCommitmentMode,
    tacticsMayEndTurn,
} from './commitment/turnGate.js';
import { buildInitialTacticsEntities } from './entities.js';
import type { TacticsSnapshot } from './stamina.js';
import { consumeStamina, readStamina } from './stamina.js';

export { TACTICS_ATTACK_ACTION, TACTICS_MOVE_UNIT_ACTION, TACTICS_REVEAL_TILE_ACTION };

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

export interface TacticsAttackPayload {
    readonly attackerId: EntityId;
    readonly defenderId: EntityId;
}

export interface TacticsRevealTilePayload {
    readonly scoutId: EntityId;
    readonly x: TacticsGridCoordinate;
    readonly y: TacticsGridCoordinate;
}

export interface TacticsGameInitializationConfig {
    readonly hostPlayerId: PlayerId;
    readonly firstPlayer?: PlayerId;
}

export function resolveTacticsFirstPlayer(config: TacticsGameInitializationConfig): PlayerId {
    return config.firstPlayer ?? config.hostPlayerId;
}

interface TacticsUnitEntity extends BaseEntityState {
    readonly kind: 'unit';
    readonly ownerId: PlayerId;
    readonly x: TacticsGridCoordinate;
    readonly y: TacticsGridCoordinate;
    readonly hp: number;
    readonly visibleTo?: readonly PlayerId[];
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
        readonly hp?: unknown;
        readonly visibleTo?: unknown;
    };
    return (
        candidate.kind === 'unit' &&
        typeof candidate.ownerId === 'string' &&
        Number.isInteger(candidate.x) &&
        Number.isInteger(candidate.y) &&
        Number.isInteger(candidate.hp) &&
        (candidate.visibleTo === undefined ||
            (Array.isArray(candidate.visibleTo) &&
                candidate.visibleTo.every((viewer) => typeof viewer === 'string')))
    );
}

function areAdjacent(first: TacticsUnitEntity, second: TacticsUnitEntity): boolean {
    const dx = first.x > second.x ? first.x - second.x : second.x - first.x;
    const dy = first.y > second.y ? first.y - second.y : second.y - first.y;
    return dx + dy === 1;
}

function isAdjacentTile(
    unit: TacticsUnitEntity,
    x: TacticsGridCoordinate,
    y: TacticsGridCoordinate,
): boolean {
    const dx = unit.x > x ? unit.x - x : x - unit.x;
    const dy = unit.y > y ? unit.y - y : y - unit.y;
    return dx + dy === 1;
}

function squaredTileDistance(
    firstX: TacticsGridCoordinate,
    firstY: TacticsGridCoordinate,
    secondX: TacticsGridCoordinate,
    secondY: TacticsGridCoordinate,
): number {
    const deltaX = firstX > secondX ? firstX - secondX : secondX - firstX;
    const deltaY = firstY > secondY ? firstY - secondY : secondY - firstY;
    return deltaX * deltaX + deltaY * deltaY;
}

function isWithinProximityRevealRange(
    scout: TacticsUnitEntity,
    candidate: TacticsUnitEntity,
): boolean {
    return (
        squaredTileDistance(scout.x, scout.y, candidate.x, candidate.y) <=
        TACTICS_PROXIMITY_REVEAL_RANGE_TILES_SQUARED
    );
}

function visibleToWithViewer(unit: TacticsUnitEntity, viewerId: PlayerId): readonly PlayerId[] {
    const seen = new Set<PlayerId>();
    const visibleTo: PlayerId[] = [];

    const add = (id: PlayerId): void => {
        if (seen.has(id)) return;
        seen.add(id);
        visibleTo.push(id);
    };

    add(unit.ownerId);
    for (const existingViewer of unit.visibleTo ?? []) {
        add(existingViewer);
    }
    add(viewerId);

    return visibleTo;
}

function revealNearbyOpponentUnits(
    entities: Readonly<Record<EntityId, BaseEntityState>>,
    scout: TacticsUnitEntity,
    viewerId: PlayerId,
): BaseGameSnapshot['entities'] {
    const nextEntities: BaseGameSnapshot['entities'] = { ...entities };
    let revealedScout = scout;

    for (const entity of Object.values(entities)) {
        if (
            !isTacticsUnitEntity(entity) ||
            entity.ownerId === viewerId ||
            !isWithinProximityRevealRange(scout, entity)
        ) {
            continue;
        }

        const revealedEntity = {
            ...entity,
            visibleTo: visibleToWithViewer(entity, viewerId),
        } satisfies BaseEntityState & Readonly<Record<string, unknown>>;
        nextEntities[entity.id] = revealedEntity;

        revealedScout = {
            ...revealedScout,
            visibleTo: visibleToWithViewer(revealedScout, entity.ownerId),
        } satisfies TacticsUnitEntity;
        nextEntities[scout.id] = revealedScout;
    }

    return nextEntities;
}

function isUnitVisibleToViewer(unit: TacticsUnitEntity, viewerId: PlayerId): boolean {
    return unit.ownerId === viewerId || (unit.visibleTo ?? []).includes(viewerId);
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
            if (readStamina(state, playerId).current <= 0) {
                return { ok: false, reason: 'insufficient_stamina' };
            }
            return { ok: true };
        },

        reduce(state, payload, playerId): BaseGameSnapshot {
            const unit = state.entities[payload.unitId];
            if (!isTacticsUnitEntity(unit)) {
                return state;
            }
            const movedUnit = {
                ...unit,
                x: payload.x,
                y: payload.y,
            } satisfies TacticsUnitEntity;
            const movedEntities: BaseGameSnapshot['entities'] = {
                ...state.entities,
                [payload.unitId]: movedUnit,
            };

            const next: TacticsSnapshot = {
                ...state,
                tick: state.tick + 1,
                entities: revealNearbyOpponentUnits(movedEntities, movedUnit, playerId),
                playerStamina: consumeStamina(state, playerId),
                events: [...state.events, { type: TACTICS_MOVE_UNIT_ACTION }],
            };
            return next;
        },
    };

export const tacticsAttackDefinition: ActionDefinition<TacticsAttackPayload, BaseGameSnapshot> = {
    type: TACTICS_ATTACK_ACTION,

    parsePayload(raw: Readonly<Record<string, unknown>>): TacticsAttackPayload {
        const attackerId = raw['attackerId'];
        const defenderId = raw['defenderId'];
        if (typeof attackerId !== 'string' || attackerId.length === 0) {
            throw new TypeError('tactics:attack payload must include a non-empty attackerId.');
        }
        if (typeof defenderId !== 'string' || defenderId.length === 0) {
            throw new TypeError('tactics:attack payload must include a non-empty defenderId.');
        }
        return {
            attackerId: entityId(attackerId),
            defenderId: entityId(defenderId),
        };
    },

    validate(payload, state, playerId): ValidationResult {
        const attacker = state.entities[payload.attackerId];
        const defender = state.entities[payload.defenderId];
        if (!isTacticsUnitEntity(attacker)) {
            return { ok: false, reason: 'attacker_not_found' };
        }
        if (!isTacticsUnitEntity(defender)) {
            return { ok: false, reason: 'defender_not_found' };
        }
        if (attacker.ownerId !== playerId) {
            return { ok: false, reason: 'not_attacker_owner' };
        }
        if (defender.ownerId === playerId) {
            return { ok: false, reason: 'cannot_attack_own_unit' };
        }
        if (!isUnitVisibleToViewer(defender, playerId)) {
            return { ok: false, reason: 'defender_not_visible' };
        }
        if (!areAdjacent(attacker, defender)) {
            return { ok: false, reason: 'defender_not_adjacent' };
        }
        if (readStamina(state, playerId).current <= 0) {
            return { ok: false, reason: 'insufficient_stamina' };
        }
        return { ok: true };
    },

    reduce(state, payload, playerId): BaseGameSnapshot {
        const defender = state.entities[payload.defenderId];
        if (!isTacticsUnitEntity(defender)) {
            return state;
        }

        const next: TacticsSnapshot = {
            ...state,
            tick: state.tick + 1,
            entities: {
                ...state.entities,
                [payload.defenderId]: {
                    ...defender,
                    hp: defender.hp <= 0 ? 0 : defender.hp - 1,
                },
            },
            playerStamina: consumeStamina(state, playerId),
            events: [...state.events, { type: TACTICS_ATTACK_ACTION }],
        };
        return next;
    },
};

export const tacticsRevealTileDefinition: ActionDefinition<
    TacticsRevealTilePayload,
    BaseGameSnapshot
> = {
    type: TACTICS_REVEAL_TILE_ACTION,

    parsePayload(raw: Readonly<Record<string, unknown>>): TacticsRevealTilePayload {
        const scoutId = raw['scoutId'];
        const x = raw['x'];
        const y = raw['y'];
        if (typeof scoutId !== 'string' || scoutId.length === 0) {
            throw new TypeError('tactics:reveal_tile payload must include a non-empty scoutId.');
        }
        if (
            typeof x !== 'number' ||
            typeof y !== 'number' ||
            !Number.isInteger(x) ||
            !Number.isInteger(y)
        ) {
            throw new TypeError('tactics:reveal_tile payload x and y must be integers.');
        }
        return {
            scoutId: entityId(scoutId),
            x: tacticsGridCoordinate(x),
            y: tacticsGridCoordinate(y),
        };
    },

    validate(payload, state, playerId): ValidationResult {
        const scout = state.entities[payload.scoutId];
        if (!isTacticsUnitEntity(scout)) {
            return { ok: false, reason: 'scout_not_found' };
        }
        if (scout.ownerId !== playerId) {
            return { ok: false, reason: 'not_scout_owner' };
        }
        if (!isAdjacentTile(scout, payload.x, payload.y)) {
            return { ok: false, reason: 'target_not_adjacent' };
        }
        return { ok: true };
    },

    reduce(state, payload, playerId): BaseGameSnapshot {
        const nextEntities: BaseGameSnapshot['entities'] = { ...state.entities };

        for (const entity of Object.values(state.entities)) {
            if (
                !isTacticsUnitEntity(entity) ||
                entity.ownerId === playerId ||
                entity.x !== payload.x ||
                entity.y !== payload.y
            ) {
                continue;
            }

            const revealedEntity = {
                ...entity,
                visibleTo: visibleToWithViewer(entity, playerId),
            } satisfies BaseEntityState & Readonly<Record<string, unknown>>;
            nextEntities[entity.id] = revealedEntity;
        }

        return {
            ...state,
            tick: state.tick + 1,
            entities: nextEntities,
            events: [...state.events, { type: TACTICS_REVEAL_TILE_ACTION }],
        };
    },
};

function resolveTacticsGameResult(snapshot: Readonly<BaseGameSnapshot>): GameResult | null {
    const units = Object.values(snapshot.entities).filter(isTacticsUnitEntity);
    const allOwnerIds = uniquePlayerIds(units.map((unit) => unit.ownerId));
    if (allOwnerIds.length <= 1) {
        return null;
    }

    const survivingOwnerIds = uniquePlayerIds(
        units.filter((unit) => unit.hp > 0).map((unit) => unit.ownerId),
    );
    if (survivingOwnerIds.length === 0) {
        return { winnerIds: [] };
    }
    if (survivingOwnerIds.length === 1) {
        return { winnerIds: survivingOwnerIds };
    }
    return null;
}

function uniquePlayerIds(playerIds: readonly PlayerId[]): PlayerId[] {
    const seen = new Set<PlayerId>();
    const result: PlayerId[] = [];
    for (const playerId of playerIds) {
        if (!seen.has(playerId)) {
            seen.add(playerId);
            result.push(playerId);
        }
    }
    return result;
}

/**
 * End-turn guard for tactics (T8 / #728). In sequential mode end-turn is always
 * allowed. In commitment mode `End Turn` is reveal-only and enabled only once
 * every seated player has committed for the current turn — so this rejects with
 * `awaiting_commitment` until each player in `state.players` has a
 * `committedTurns` entry equal to the current `turnNumber` (stale entries from
 * prior turns do not count). Pure: reads only deterministic snapshot fields.
 */
function tacticsCanEndTurn(
    state: Readonly<BaseGameSnapshot>,
    _playerId: PlayerId,
): ValidationResult {
    if (!isTacticsCommitmentMode(state)) {
        return { ok: true };
    }
    return allSeatsCommitted(state) ? { ok: true } : { ok: false, reason: 'awaiting_commitment' };
}

export function registerTacticsActions(registry: ActionRegistry<BaseGameSnapshot>): void {
    registry.register(tacticsMoveUnitDefinition);
    registry.register(tacticsAttackDefinition);
    registry.register(tacticsRevealTileDefinition);
    registry.register(tacticsCommitDefinition);
    registry.registerGame('tactics', {
        buildInitialEntities: buildInitialTacticsEntities,
        resolveGameResult: resolveTacticsGameResult,
        canEndTurn: tacticsCanEndTurn,
        // Simultaneous commitment turns: any seat may fire the reveal-only End
        // Turn once every seat has committed (the active-player gate would
        // deadlock a parallel turn). Sequential mode keeps active-player-only.
        mayEndTurn: tacticsMayEndTurn,
    });
}
