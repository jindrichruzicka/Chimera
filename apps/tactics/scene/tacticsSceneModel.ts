import type { GameSetupConfig } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import type { EntityId, PlayerId } from '@chimera-engine/simulation/engine/types.js';
import {
    DEFAULT_BOARD_COLOR,
    DEFAULT_BOARD_COLOR_HEX,
    DEFAULT_PLAYER_COLOR,
    DEFAULT_PLAYER_COLOR_HEX,
} from '../lobby/lobby-setup.js';

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
              // Ground click resolving to the selected unit's CURRENT tile. Not a
              // move, and must not reach the simulation, which would charge a
              // stamina for zero displacement — see `resolveGroundTargetIntent`.
              | 'target-not-moved'
              | 'unknown-target';
      };

export type ProjectedTacticsEntityFields = Readonly<{ readonly id: EntityId }>;

/** Statically-known fields of a projected tactics player; the game-specific
 * `stamina` field rides along at runtime and is narrowed defensively. */
export type ProjectedTacticsPlayerFields = Readonly<{ readonly id: PlayerId }>;

/** Renderer-facing stamina readout parsed from the projected player snapshot. */
export interface TacticsStaminaReadout {
    readonly current: number;
    readonly max: number;
}

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
    return { x: roundGridCoordinate(world.x), y: roundGridCoordinate(world.z) };
}

/**
 * `Math.round(-0.4)` yields `-0`, and a `-0` coordinate entering a move action
 * diverges between transports: structured-clone IPC preserves the sign while
 * JSON (wire frames, save files) normalises it to `0`, so two views of the
 * same tile stop being deeply equal. Adding `+0` folds `-0` into `0` and
 * leaves every other integer untouched.
 */
function roundGridCoordinate(value: number): number {
    return Math.round(value) + 0;
}

export function classifyTacticsUnitOwnership(
    ownerId: PlayerId,
    localPlayerId: PlayerId | undefined,
): TacticsUnitOwnership {
    return localPlayerId !== undefined && ownerId === localPlayerId ? 'own' : 'opponent';
}

/**
 * Resolve the ground-plane material colour from the host's lobby setup, mapping
 * the chosen board-colour name to its hex via the `boardColorHex` map the caller
 * derived from content (`paletteFromCollections`). Falls back to the default
 * slate when `setup` is absent, the chosen name is off-palette, or content has
 * not loaded (empty map) — slate reproduces the default ground.
 */
export function resolveTacticsBoardColor(
    setup: GameSetupConfig | undefined,
    boardColorHex: Readonly<Record<string, string>>,
): string {
    const name = setup?.matchSettings['boardColor'] ?? DEFAULT_BOARD_COLOR;
    return boardColorHex[name] ?? DEFAULT_BOARD_COLOR_HEX;
}

/**
 * Resolve a unit's material colour from its owner's host-assigned lobby colour,
 * mapping the chosen player-colour name to its hex via the `playerColorHex` map
 * the caller derived from content. The same owner renders the same colour for
 * every viewer (Invariant #62: read from host `setup`, never from client profile
 * data). Falls back to the default blue when `setup` is absent, the owner has no
 * assigned colour, the chosen name is off-palette, or content has not loaded; the
 * persistent own-unit ring still distinguishes the local player's units then.
 */
export function resolveTacticsUnitColor(
    ownerId: PlayerId,
    setup: GameSetupConfig | undefined,
    playerColorHex: Readonly<Record<string, string>>,
): string {
    const name = setup?.playerAttributes[ownerId]?.['color'] ?? DEFAULT_PLAYER_COLOR;
    return playerColorHex[name] ?? DEFAULT_PLAYER_COLOR_HEX;
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

/**
 * Reads the viewer's own stamina from the projected `PlayerSnapshot.players`
 * map. Stamina is owner-only: the projection gives the viewer their own
 * `{ current, max }` and masks every other player to `null`. The generic
 * projection type carries only `{ id }`, so the game-specific `stamina` field is
 * narrowed defensively here — never recomputed from `GameSnapshot` (Invariant
 * #3/#8). Returns `null` when the viewer has no entry, stamina is absent/masked
 * (a non-owner), or the values are malformed.
 */
export function parseTacticsViewerStamina(
    players: Readonly<Record<PlayerId, ProjectedTacticsPlayerFields>>,
    viewerId: PlayerId,
): TacticsStaminaReadout | null {
    const player = players[viewerId] as Readonly<Record<string, unknown>> | undefined;
    const stamina = player?.['stamina'] as Readonly<Record<string, unknown>> | null | undefined;
    if (stamina === null || stamina === undefined) {
        return null;
    }

    const current = stamina['current'];
    const max = stamina['max'];
    if (!isInteger(current) || !isInteger(max)) {
        return null;
    }

    return { current, max };
}

/**
 * Reads the non-secret per-seat `committed` marker from a projected player
 * (commitment battle mode). The projection sets it for every seat to every
 * viewer (only the boolean crosses, never the buffer — Invariants #3/#8), so the
 * renderer can gate the reveal-only End Turn. Narrowed defensively like stamina;
 * absent/malformed ⇒ `false` (sequential mode).
 */
export function parseTacticsSeatCommitted(
    players: Readonly<Record<PlayerId, ProjectedTacticsPlayerFields>>,
    playerId: PlayerId,
): boolean {
    const player = players[playerId] as Readonly<Record<string, unknown>> | undefined;
    return player?.['committed'] === true;
}

/**
 * True iff there is at least one seat and EVERY seat has committed this turn —
 * the renderer mirror of the host's `tacticsCanEndTurn` gate. Drives whether the
 * commitment-mode End Turn (reveal trigger) is enabled.
 */
export function parseTacticsAllSeatsCommitted(
    players: Readonly<Record<PlayerId, ProjectedTacticsPlayerFields>>,
): boolean {
    const ids = Object.keys(players);
    return ids.length > 0 && ids.every((id) => parseTacticsSeatCommitted(players, id as PlayerId));
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
    // A "move" onto the tile the unit already occupies is not a move, and must
    // never reach the simulation: `tacticsMoveUnitDefinition.validate()` checks
    // unit-exists, ownership and `stamina > 0` only — there is no distance check
    // — so `reduce()` would spend a stamina for zero displacement.
    //
    // Not a theoretical case. The unit mesh is TWEENED between tiles
    // (DEFAULT_UNIT_MOVEMENT_DURATION_MS), so a click aimed at the unit while it
    // is still animating can miss the mesh and hit the ground plane behind it.
    // A no-op does not clear the selection, so that stray click arrives with a
    // live selection and resolves here — burning a turn resource with nothing to
    // show for it. Rejecting it at the intent layer keeps the simulation's
    // range-unlimited move rule untouched.
    if (grid.x === selectedUnit.grid.x && grid.y === selectedUnit.grid.y) {
        return { type: 'noop', reason: 'target-not-moved' };
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
