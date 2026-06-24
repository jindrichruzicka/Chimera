import { describe, expect, it } from 'vitest';
import type { GameSetupConfig } from '@chimera/simulation/foundation/game-lobby-contract.js';
import {
    entityId,
    playerId,
    type EntityId,
    type PlayerId,
} from '@chimera/simulation/engine/types.js';
import {
    gridToWorldPoint,
    parseTacticsAllSeatsCommitted,
    parseTacticsSceneUnit,
    parseTacticsSceneUnits,
    parseTacticsSeatCommitted,
    parseTacticsViewerStamina,
    resolveTacticsBoardColor,
    resolveTacticsSelectionIntent,
    resolveTacticsUnitColor,
    worldToGridPoint,
    type ProjectedTacticsEntityFields,
    type ProjectedTacticsPlayerFields,
    type TacticsSceneUnit,
} from './tacticsSceneModel';

const LOCAL_PLAYER = playerId('p1');
const OPPONENT_PLAYER = playerId('p2');
const OWN_UNIT = entityId('unit-1');
const OPPONENT_UNIT = entityId('unit-2');

type ProjectedEntityFixture = ProjectedTacticsEntityFields & Readonly<Record<string, unknown>>;

function projectedUnit(options: {
    readonly id: EntityId;
    readonly ownerId: PlayerId;
    readonly x: number;
    readonly y: number;
    readonly hp?: number;
}): ProjectedEntityFixture {
    return {
        id: options.id,
        kind: 'unit',
        ownerId: options.ownerId,
        x: options.x,
        y: options.y,
        hp: options.hp ?? 1,
    };
}

function ownSceneUnit(overrides: Partial<TacticsSceneUnit> = {}): TacticsSceneUnit {
    return {
        id: OWN_UNIT,
        ownerId: LOCAL_PLAYER,
        ownership: 'own',
        grid: { x: 0, y: 0 },
        world: { x: 0, y: 0, z: 0 },
        hp: 1,
        isAlive: true,
        ...overrides,
    };
}

function opponentSceneUnit(overrides: Partial<TacticsSceneUnit> = {}): TacticsSceneUnit {
    return {
        id: OPPONENT_UNIT,
        ownerId: OPPONENT_PLAYER,
        ownership: 'opponent',
        grid: { x: 1, y: 0 },
        world: { x: 1, y: 0, z: 0 },
        hp: 1,
        isAlive: true,
        ...overrides,
    };
}

describe('tacticsSceneModel', () => {
    it('parses projected tactics unit fields into renderer scene units', () => {
        expect(
            parseTacticsSceneUnit(
                projectedUnit({ id: OWN_UNIT, ownerId: LOCAL_PLAYER, x: 2, y: 3, hp: 4 }),
                LOCAL_PLAYER,
            ),
        ).toEqual({
            id: OWN_UNIT,
            ownerId: LOCAL_PLAYER,
            ownership: 'own',
            grid: { x: 2, y: 3 },
            world: { x: 2, y: 0, z: 3 },
            hp: 4,
            isAlive: true,
        });

        expect(
            parseTacticsSceneUnit(
                projectedUnit({ id: OPPONENT_UNIT, ownerId: OPPONENT_PLAYER, x: 1, y: 0 }),
                LOCAL_PLAYER,
            )?.ownership,
        ).toBe('opponent');
    });

    it('rejects malformed projected entities instead of representing them as units', () => {
        const malformedEntities: readonly ProjectedEntityFixture[] = [
            { id: entityId('terrain'), kind: 'terrain' },
            { id: entityId('missing-owner'), kind: 'unit', x: 0, y: 0, hp: 1 },
            {
                id: entityId('fractional-x'),
                kind: 'unit',
                ownerId: LOCAL_PLAYER,
                x: 0.5,
                y: 0,
                hp: 1,
            },
            { id: entityId('missing-hp'), kind: 'unit', ownerId: LOCAL_PLAYER, x: 0, y: 0 },
        ];

        expect(
            malformedEntities.map((entity) => parseTacticsSceneUnit(entity, LOCAL_PLAYER)),
        ).toEqual([null, null, null, null]);
    });

    it('only represents entities present in the projected snapshot input', () => {
        const units = parseTacticsSceneUnits(
            {
                [OWN_UNIT]: projectedUnit({ id: OWN_UNIT, ownerId: LOCAL_PLAYER, x: 0, y: 0 }),
            },
            LOCAL_PLAYER,
        );

        expect(units).toHaveLength(1);
        expect(units.map((unit) => unit.id)).toEqual([OWN_UNIT]);
        expect(units.some((unit) => unit.id === OPPONENT_UNIT)).toBe(false);
    });

    it('converts between tactics grid points and renderer world points without Three.js types', () => {
        expect(gridToWorldPoint({ x: 2, y: -3 })).toEqual({ x: 2, y: 0, z: -3 });
        expect(worldToGridPoint({ x: 2.4, y: 9, z: -2.6 })).toEqual({ x: 2, y: -3 });
    });

    it('resolves own-unit and opponent-unit selection intents', () => {
        const units = [ownSceneUnit(), opponentSceneUnit()];

        expect(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId: LOCAL_PLAYER,
                selectedUnitId: null,
                target: { type: 'unit', unitId: OWN_UNIT },
            }),
        ).toEqual({ type: 'select-own-unit', unitId: OWN_UNIT });

        expect(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId: LOCAL_PLAYER,
                selectedUnitId: null,
                target: { type: 'unit', unitId: OPPONENT_UNIT },
            }),
        ).toEqual({ type: 'select-opponent-unit', unitId: OPPONENT_UNIT });
    });

    it('resolves ground-move and opponent-attack intents for a selected own unit', () => {
        const units = [ownSceneUnit(), opponentSceneUnit()];

        expect(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId: LOCAL_PLAYER,
                selectedUnitId: OWN_UNIT,
                target: { type: 'ground', grid: { x: 1, y: 0 } },
            }),
        ).toEqual({ type: 'move-unit', unitId: OWN_UNIT, grid: { x: 1, y: 0 } });

        expect(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId: LOCAL_PLAYER,
                selectedUnitId: OWN_UNIT,
                target: { type: 'unit', unitId: OPPONENT_UNIT },
            }),
        ).toEqual({ type: 'attack-unit', attackerId: OWN_UNIT, defenderId: OPPONENT_UNIT });
    });

    it('returns no-op intent when an opponent unit would be controlled', () => {
        const units = [ownSceneUnit(), opponentSceneUnit()];

        expect(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId: LOCAL_PLAYER,
                selectedUnitId: OPPONENT_UNIT,
                target: { type: 'ground', grid: { x: 2, y: 0 } },
            }),
        ).toEqual({ type: 'noop', reason: 'opponent-control' });
    });

    it('returns noop:missing-local-player when no local player is known', () => {
        const units = [ownSceneUnit()];

        expect(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId: undefined,
                selectedUnitId: null,
                target: { type: 'unit', unitId: OWN_UNIT },
            }),
        ).toEqual({ type: 'noop', reason: 'missing-local-player' });
    });

    it('returns noop:missing-selection when a ground target is clicked with no unit selected', () => {
        const units = [ownSceneUnit()];

        expect(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId: LOCAL_PLAYER,
                selectedUnitId: null,
                target: { type: 'ground', grid: { x: 1, y: 0 } },
            }),
        ).toEqual({ type: 'noop', reason: 'missing-selection' });
    });

    it('returns noop:unknown-target when the target unit id is not in the units list', () => {
        const units = [ownSceneUnit()];
        const unknownId = entityId('does-not-exist');

        expect(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId: LOCAL_PLAYER,
                selectedUnitId: null,
                target: { type: 'unit', unitId: unknownId },
            }),
        ).toEqual({ type: 'noop', reason: 'unknown-target' });
    });
});

type ProjectedPlayerFixture = ProjectedTacticsPlayerFields & Readonly<Record<string, unknown>>;

function projectedPlayers(
    entries: Readonly<Record<string, unknown>>,
): Readonly<Record<PlayerId, ProjectedTacticsPlayerFields>> {
    return entries as Readonly<Record<PlayerId, ProjectedTacticsPlayerFields>>;
}

describe('parseTacticsViewerStamina', () => {
    it("reads the viewer's own projected stamina as { current, max }", () => {
        const players = projectedPlayers({
            [LOCAL_PLAYER]: {
                id: LOCAL_PLAYER,
                stamina: { current: 2, max: 3 },
            } satisfies ProjectedPlayerFixture,
            [OPPONENT_PLAYER]: {
                id: OPPONENT_PLAYER,
                stamina: null,
            } satisfies ProjectedPlayerFixture,
        });

        expect(parseTacticsViewerStamina(players, LOCAL_PLAYER)).toEqual({ current: 2, max: 3 });
    });

    it('returns null when the viewer has no entry in the projected players map', () => {
        const players = projectedPlayers({
            [OPPONENT_PLAYER]: {
                id: OPPONENT_PLAYER,
                stamina: { current: 1, max: 3 },
            } satisfies ProjectedPlayerFixture,
        });

        expect(parseTacticsViewerStamina(players, LOCAL_PLAYER)).toBeNull();
    });

    it('returns null when stamina is masked to null or absent (non-owner / pre-#721 snapshot)', () => {
        const masked = projectedPlayers({
            [LOCAL_PLAYER]: { id: LOCAL_PLAYER, stamina: null } satisfies ProjectedPlayerFixture,
        });
        const absent = projectedPlayers({
            [LOCAL_PLAYER]: { id: LOCAL_PLAYER } satisfies ProjectedPlayerFixture,
        });

        expect(parseTacticsViewerStamina(masked, LOCAL_PLAYER)).toBeNull();
        expect(parseTacticsViewerStamina(absent, LOCAL_PLAYER)).toBeNull();
    });

    it('returns null for malformed stamina values instead of rendering them', () => {
        const fractional = projectedPlayers({
            [LOCAL_PLAYER]: {
                id: LOCAL_PLAYER,
                stamina: { current: 1.5, max: 3 },
            } satisfies ProjectedPlayerFixture,
        });
        const nonNumeric = projectedPlayers({
            [LOCAL_PLAYER]: {
                id: LOCAL_PLAYER,
                stamina: { current: 2, max: 'three' },
            } satisfies ProjectedPlayerFixture,
        });

        expect(parseTacticsViewerStamina(fractional, LOCAL_PLAYER)).toBeNull();
        expect(parseTacticsViewerStamina(nonNumeric, LOCAL_PLAYER)).toBeNull();
    });
});

describe('parseTacticsSeatCommitted / parseTacticsAllSeatsCommitted', () => {
    it('reads the per-seat committed marker, defaulting absent to false', () => {
        const players = projectedPlayers({
            [LOCAL_PLAYER]: {
                id: LOCAL_PLAYER,
                committed: true,
            } satisfies ProjectedPlayerFixture,
            [OPPONENT_PLAYER]: { id: OPPONENT_PLAYER } satisfies ProjectedPlayerFixture,
        });

        expect(parseTacticsSeatCommitted(players, LOCAL_PLAYER)).toBe(true);
        expect(parseTacticsSeatCommitted(players, OPPONENT_PLAYER)).toBe(false);
    });

    it('all-seats-committed requires every seat true', () => {
        const partial = projectedPlayers({
            [LOCAL_PLAYER]: { id: LOCAL_PLAYER, committed: true } satisfies ProjectedPlayerFixture,
            [OPPONENT_PLAYER]: {
                id: OPPONENT_PLAYER,
                committed: false,
            } satisfies ProjectedPlayerFixture,
        });
        const all = projectedPlayers({
            [LOCAL_PLAYER]: { id: LOCAL_PLAYER, committed: true } satisfies ProjectedPlayerFixture,
            [OPPONENT_PLAYER]: {
                id: OPPONENT_PLAYER,
                committed: true,
            } satisfies ProjectedPlayerFixture,
        });

        expect(parseTacticsAllSeatsCommitted(partial)).toBe(false);
        expect(parseTacticsAllSeatsCommitted(all)).toBe(true);
    });

    it('all-seats-committed is false for an empty players map', () => {
        expect(parseTacticsAllSeatsCommitted(projectedPlayers({}))).toBe(false);
    });
});

// Hex maps as the caller would derive them from loaded content via
// `paletteFromCollections`. The resolvers are pure and take these explicitly.
const PLAYER_COLOR_HEX: Readonly<Record<string, string>> = {
    blue: '#2563eb',
    red: '#dc2626',
    green: '#16a34a',
    amber: '#f59e0b',
};
const BOARD_COLOR_HEX: Readonly<Record<string, string>> = {
    slate: '#3f3f46',
    stone: '#44403c',
    navy: '#1e293b',
};

describe('resolveTacticsBoardColor', () => {
    it('maps the host-configured board colour name to its hex', () => {
        const setup: GameSetupConfig = {
            matchSettings: { boardColor: 'navy' },
            playerAttributes: {},
        };

        expect(resolveTacticsBoardColor(setup, BOARD_COLOR_HEX)).toBe('#1e293b');
    });

    it('falls back to the default slate hex when setup is absent', () => {
        expect(resolveTacticsBoardColor(undefined, BOARD_COLOR_HEX)).toBe('#3f3f46');
    });

    it('falls back to the default slate hex for an off-palette board colour name', () => {
        const setup: GameSetupConfig = {
            matchSettings: { boardColor: 'periwinkle' },
            playerAttributes: {},
        };

        expect(resolveTacticsBoardColor(setup, BOARD_COLOR_HEX)).toBe('#3f3f46');
    });

    it('falls back to the default slate hex when the hex map is empty (content not loaded)', () => {
        const setup: GameSetupConfig = {
            matchSettings: { boardColor: 'navy' },
            playerAttributes: {},
        };

        expect(resolveTacticsBoardColor(setup, {})).toBe('#3f3f46');
    });
});

describe('resolveTacticsUnitColor', () => {
    it("maps each owner's host-assigned colour name to its hex", () => {
        const setup: GameSetupConfig = {
            matchSettings: {},
            playerAttributes: {
                [LOCAL_PLAYER]: { color: 'green' },
                [OPPONENT_PLAYER]: { color: 'amber' },
            },
        };

        expect(resolveTacticsUnitColor(LOCAL_PLAYER, setup, PLAYER_COLOR_HEX)).toBe('#16a34a');
        expect(resolveTacticsUnitColor(OPPONENT_PLAYER, setup, PLAYER_COLOR_HEX)).toBe('#f59e0b');
    });

    it('falls back to the default blue hex when setup is absent', () => {
        expect(resolveTacticsUnitColor(LOCAL_PLAYER, undefined, PLAYER_COLOR_HEX)).toBe('#2563eb');
    });

    it('falls back to the default blue hex for an owner with no assigned colour', () => {
        const setup: GameSetupConfig = {
            matchSettings: {},
            playerAttributes: { [LOCAL_PLAYER]: { color: 'green' } },
        };

        expect(resolveTacticsUnitColor(OPPONENT_PLAYER, setup, PLAYER_COLOR_HEX)).toBe('#2563eb');
    });

    it('falls back to the default blue hex for an off-palette colour name', () => {
        const setup: GameSetupConfig = {
            matchSettings: {},
            playerAttributes: { [LOCAL_PLAYER]: { color: 'chartreuse' } },
        };

        expect(resolveTacticsUnitColor(LOCAL_PLAYER, setup, PLAYER_COLOR_HEX)).toBe('#2563eb');
    });

    it('falls back to the default blue hex when the hex map is empty (content not loaded)', () => {
        const setup: GameSetupConfig = {
            matchSettings: {},
            playerAttributes: { [LOCAL_PLAYER]: { color: 'green' } },
        };

        expect(resolveTacticsUnitColor(LOCAL_PLAYER, setup, {})).toBe('#2563eb');
    });
});
