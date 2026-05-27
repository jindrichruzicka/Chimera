import type { EntityId, PlayerId } from '@chimera/simulation/engine/types.js';

export interface TacticsGridPoint {
    readonly x: number;
    readonly y: number;
}

export interface TacticsWorldPoint {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export type TacticsUnitOwnership = 'own' | 'opponent';

export interface TacticsSceneUnit {
    readonly id: EntityId;
    readonly ownerId: PlayerId;
    readonly ownership: TacticsUnitOwnership;
    readonly grid: TacticsGridPoint;
    readonly world: TacticsWorldPoint;
    readonly hp: number;
    readonly isAlive: boolean;
}

export type TacticsClickTarget =
    | { readonly type: 'ground'; readonly grid: TacticsGridPoint }
    | { readonly type: 'unit'; readonly unitId: EntityId };

export type TacticsSelectionIntent =
    | { readonly type: 'select-own-unit'; readonly unitId: EntityId }
    | { readonly type: 'select-opponent-unit'; readonly unitId: EntityId }
    | { readonly type: 'move-unit'; readonly unitId: EntityId; readonly grid: TacticsGridPoint }
    | { readonly type: 'attack-unit'; readonly attackerId: EntityId; readonly defenderId: EntityId }
    | { readonly type: 'reveal-tile'; readonly scoutId: EntityId; readonly grid: TacticsGridPoint }
    | {
          readonly type: 'noop';
          readonly reason:
              | 'missing-local-player'
              | 'missing-selection'
              | 'opponent-control'
              | 'unknown-target';
      };

export type ProjectedTacticsEntityFields = Readonly<{ readonly id: EntityId }>;

export interface TacticsSelectionIntentRequest {
    readonly units: readonly TacticsSceneUnit[];
    readonly localPlayerId: PlayerId | undefined;
    readonly selectedUnitId: EntityId | null;
    readonly target: TacticsClickTarget;
}

export function gridToWorldPoint(grid: TacticsGridPoint): TacticsWorldPoint {
    return { x: grid.x, y: 0, z: grid.y };
}

export function worldToGridPoint(world: TacticsWorldPoint): TacticsGridPoint {
    return { x: Math.round(world.x), y: Math.round(world.z) };
}

export function classifyTacticsUnitOwnership(
    ownerId: PlayerId,
    localPlayerId: PlayerId | undefined,
): TacticsUnitOwnership {
    return localPlayerId !== undefined && ownerId === localPlayerId ? 'own' : 'opponent';
}

export function parseTacticsSceneUnit(
    entity: ProjectedTacticsEntityFields,
    localPlayerId: PlayerId | undefined,
): TacticsSceneUnit | null {
    const candidate = entity as Readonly<Record<string, unknown>>;
    const ownerId = candidate['ownerId'];
    const x = candidate['x'];
    const y = candidate['y'];
    const hp = candidate['hp'];

    if (
        candidate['kind'] !== 'unit' ||
        typeof entity.id !== 'string' ||
        entity.id.length === 0 ||
        typeof ownerId !== 'string' ||
        !isInteger(x) ||
        !isInteger(y) ||
        !isInteger(hp)
    ) {
        return null;
    }

    const grid = { x, y } satisfies TacticsGridPoint;
    const typedOwnerId = ownerId as PlayerId;

    return {
        id: entity.id,
        ownerId: typedOwnerId,
        ownership: classifyTacticsUnitOwnership(typedOwnerId, localPlayerId),
        grid,
        world: gridToWorldPoint(grid),
        hp,
        isAlive: hp > 0,
    };
}

export function parseTacticsSceneUnits(
    entities: Readonly<Record<EntityId, ProjectedTacticsEntityFields>>,
    localPlayerId: PlayerId | undefined,
): readonly TacticsSceneUnit[] {
    const units: TacticsSceneUnit[] = [];

    for (const entity of Object.values(entities)) {
        const unit = parseTacticsSceneUnit(entity, localPlayerId);
        if (unit !== null) {
            units.push(unit);
        }
    }

    return units;
}

export function resolveTacticsSelectionIntent({
    units,
    localPlayerId,
    selectedUnitId,
    target,
}: TacticsSelectionIntentRequest): TacticsSelectionIntent {
    if (localPlayerId === undefined) {
        return { type: 'noop', reason: 'missing-local-player' };
    }

    if (target.type === 'unit') {
        return resolveUnitTargetIntent(units, selectedUnitId, target.unitId);
    }

    return resolveGroundTargetIntent(units, selectedUnitId, target.grid);
}

function resolveUnitTargetIntent(
    units: readonly TacticsSceneUnit[],
    selectedUnitId: EntityId | null,
    targetUnitId: EntityId,
): TacticsSelectionIntent {
    const targetUnit = findUnit(units, targetUnitId);
    if (targetUnit === undefined) {
        return { type: 'noop', reason: 'unknown-target' };
    }
    if (targetUnit.ownership === 'own') {
        return { type: 'select-own-unit', unitId: targetUnit.id };
    }

    const selectedUnit = selectedUnitId === null ? undefined : findUnit(units, selectedUnitId);
    if (selectedUnit === undefined) {
        return { type: 'select-opponent-unit', unitId: targetUnit.id };
    }
    if (selectedUnit.ownership !== 'own') {
        return { type: 'noop', reason: 'opponent-control' };
    }
    if (!areAdjacent(selectedUnit.grid, targetUnit.grid)) {
        return { type: 'select-opponent-unit', unitId: targetUnit.id };
    }

    return { type: 'attack-unit', attackerId: selectedUnit.id, defenderId: targetUnit.id };
}

function resolveGroundTargetIntent(
    units: readonly TacticsSceneUnit[],
    selectedUnitId: EntityId | null,
    grid: TacticsGridPoint,
): TacticsSelectionIntent {
    if (selectedUnitId === null) {
        return { type: 'noop', reason: 'missing-selection' };
    }

    const selectedUnit = findUnit(units, selectedUnitId);
    if (selectedUnit === undefined) {
        return { type: 'noop', reason: 'unknown-target' };
    }
    if (selectedUnit.ownership !== 'own') {
        return { type: 'noop', reason: 'opponent-control' };
    }

    return { type: 'move-unit', unitId: selectedUnit.id, grid };
}

function findUnit(
    units: readonly TacticsSceneUnit[],
    unitId: EntityId,
): TacticsSceneUnit | undefined {
    return units.find((unit) => unit.id === unitId);
}

function areAdjacent(first: TacticsGridPoint, second: TacticsGridPoint): boolean {
    const deltaX = Math.abs(first.x - second.x);
    const deltaY = Math.abs(first.y - second.y);
    return deltaX + deltaY === 1;
}

function isInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value);
}
