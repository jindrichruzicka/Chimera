import { describe, expect, it } from 'vitest';
import {
    TACTICS_BOARD_MAX_X,
    TACTICS_BOARD_MAX_Y,
    TACTICS_BOARD_MIN_X,
    TACTICS_BOARD_MIN_Y,
    TACTICS_INITIAL_UNIT_SPACING_TILES,
    TACTICS_PROXIMITY_REVEAL_RANGE_TILES,
    TACTICS_PROXIMITY_REVEAL_RANGE_TILES_SQUARED,
} from '@chimera/shared/tactics.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { createRng } from '@chimera/simulation/engine/DeterministicRng.js';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
    GameReduceContext,
} from '@chimera/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera/simulation/engine/types.js';
import { DefaultStateProjector } from '@chimera/simulation/projection/StateProjector.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
    registerTacticsActions,
    resolveTacticsFirstPlayer,
    tacticsAttackDefinition,
    tacticsGridCoordinate,
    tacticsMoveUnitDefinition,
    tacticsRevealTileDefinition,
} from './actions.js';
import { buildInitialTacticsEntities } from './entities.js';
import { parseTacticsSceneUnits } from './screens/tacticsSceneModel.js';
import { tacticsVisibilityRules } from './visibility-rules.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');
const P3 = playerId('player-3');
const P4 = playerId('player-4');
const UNIT = entityId('unit-1');
const ENEMY_UNIT = entityId('unit-2');

function unitPositions(
    entities: Record<EntityId, BaseEntityState>,
): readonly { readonly x: number; readonly y: number }[] {
    // Reuse the renderer's typed opaque→fields projection so the test asserts
    // against the same narrowing the scene relies on. Non-unit or non-integer
    // entities are dropped, so a malformed seat shows up as a missing position.
    return parseTacticsSceneUnits(entities, undefined).map((unit) => unit.grid);
}

function makeSnapshot(
    options: {
        readonly enemyVisibleToP1?: boolean;
        readonly unitX?: number;
        readonly unitY?: number;
        readonly enemyX?: number;
        readonly enemyY?: number;
    } = {},
): BaseGameSnapshot {
    const unit = {
        id: UNIT,
        kind: 'unit',
        ownerId: P1,
        x: tacticsGridCoordinate(options.unitX ?? 0),
        y: tacticsGridCoordinate(options.unitY ?? 0),
        hp: 1,
        visibleTo: [P1],
    } satisfies BaseEntityState & {
        readonly kind: 'unit';
        readonly ownerId: typeof P1;
        readonly x: ReturnType<typeof tacticsGridCoordinate>;
        readonly y: ReturnType<typeof tacticsGridCoordinate>;
        readonly hp: number;
        readonly visibleTo: readonly (typeof P1)[];
    };
    const enemyUnit = {
        id: ENEMY_UNIT,
        kind: 'unit',
        ownerId: P2,
        x: tacticsGridCoordinate(options.enemyX ?? 1),
        y: tacticsGridCoordinate(options.enemyY ?? 0),
        hp: 1,
        visibleTo: options.enemyVisibleToP1 === true ? [P2, P1] : [P2],
    } satisfies BaseEntityState & {
        readonly kind: 'unit';
        readonly ownerId: typeof P2;
        readonly x: ReturnType<typeof tacticsGridCoordinate>;
        readonly y: ReturnType<typeof tacticsGridCoordinate>;
        readonly hp: number;
        readonly visibleTo: readonly (typeof P2)[];
    };
    return {
        tick: 1,
        seed: 42,
        players: {
            [P1]: { id: P1 },
            [P2]: { id: P2 },
        },
        entities: { [UNIT]: unit, [ENEMY_UNIT]: enemyUnit },
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: P1,
        turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
        timers: {},
        gameResult: null,
    };
}

function makeSnapshotFromEntities(entities: Record<EntityId, BaseEntityState>): BaseGameSnapshot {
    return {
        tick: 1,
        seed: 42,
        players: {
            [P1]: { id: P1 },
            [P2]: { id: P2 },
        },
        entities,
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: P1,
        turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
        timers: {},
        gameResult: null,
    };
}

function entityVisibleTo(snapshot: BaseGameSnapshot, id: EntityId): unknown {
    return (snapshot.entities[id] as unknown as Record<string, unknown>)['visibleTo'];
}

describe('tactics move unit action', () => {
    function makeReduceContext(snapshot: BaseGameSnapshot): GameReduceContext {
        return { rng: createRng(snapshot.seed, snapshot.tick), dispatchDepth: 0 };
    }

    it('normalises movement coordinates through the branded integer constructor', () => {
        expect(tacticsGridCoordinate(1)).toBe(1);
        expect(() => tacticsGridCoordinate(0.5)).toThrow('tactics coordinates must be integers.');
    });

    it('registers the move action as predictable', () => {
        const registry = new ActionRegistry();

        registerTacticsActions(registry);

        expect(registry.has(TACTICS_MOVE_UNIT_ACTION)).toBe(true);
        expect(registry.resolve(TACTICS_MOVE_UNIT_ACTION).predictable).toBe(true);
    });

    it('exports and registers the attack action for deterministic game resolution', () => {
        const registry = new ActionRegistry();

        registerTacticsActions(registry);

        expect(TACTICS_ATTACK_ACTION).toBe('tactics:attack');
        expect(registry.has(TACTICS_ATTACK_ACTION)).toBe(true);
    });

    it('exports and registers the reveal tile action for fog-of-war reveal', () => {
        const registry = new ActionRegistry();

        registerTacticsActions(registry);

        expect(TACTICS_REVEAL_TILE_ACTION).toBe('tactics:reveal_tile');
        expect(registry.has(TACTICS_REVEAL_TILE_ACTION)).toBe(true);
    });

    it('registers a GameDefinition that builds the initial tactics entities', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();

        registerTacticsActions(registry);

        const definition = registry.resolveGame('tactics');
        const initialEntities = definition?.buildInitialEntities?.([P1, P2]);

        expect(initialEntities).toBeDefined();
        expect(Object.keys(initialEntities ?? {})).toHaveLength(2);
        // First player gets unit at index 0
        const p1Unit = Object.values(initialEntities ?? {}).find(
            (e: BaseEntityState) => (e as unknown as Record<string, unknown>)['ownerId'] === P1,
        ) as unknown as Record<string, unknown>;
        expect(p1Unit['kind']).toBe('unit');
        expect(p1Unit['ownerId']).toBe(P1);
    });

    it('defaults the initial first player to the host player', () => {
        expect(resolveTacticsFirstPlayer({ hostPlayerId: P1 })).toBe(P1);
    });

    it('uses an explicit first player from Tactics initialization config', () => {
        expect(resolveTacticsFirstPlayer({ hostPlayerId: P1, firstPlayer: P2 })).toBe(P2);
    });

    it('builds initial tactics entities for each player', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();

        registerTacticsActions(registry);

        const definition = registry.resolveGame('tactics');
        const initialEntities = definition?.buildInitialEntities?.([P1, P2]);

        expect(Object.keys(initialEntities ?? {})).toHaveLength(2);
        // Both players should have a unit
        const units = Object.values(initialEntities ?? {}) as unknown as Record<string, unknown>[];
        expect(units.some((u) => u['ownerId'] === P1)).toBe(true);
        expect(units.some((u) => u['ownerId'] === P2)).toBe(true);
    });

    it('keeps the initial opponent hidden and reveals it after a valid proximity move', () => {
        const projector = new DefaultStateProjector(tacticsVisibilityRules);
        const snapshot = makeSnapshotFromEntities(buildInitialTacticsEntities([P1, P2]));

        expect(projector.project(snapshot, P1).entities[ENEMY_UNIT]).toBeUndefined();

        const payload = tacticsMoveUnitDefinition.parsePayload({
            unitId: UNIT,
            x: TACTICS_INITIAL_UNIT_SPACING_TILES - TACTICS_PROXIMITY_REVEAL_RANGE_TILES,
            y: 0,
        });
        const next = tacticsMoveUnitDefinition.reduce(
            snapshot,
            payload,
            P1,
            makeReduceContext(snapshot),
        );
        const projectedEnemy = projector.project(next, P1).entities[ENEMY_UNIT];

        expect(projectedEnemy).toMatchObject({ id: ENEMY_UNIT, ownerId: P2 });
        expect(projectedEnemy).not.toHaveProperty('visibleTo');
    });

    it('reveals proximity units to each other after a valid move', () => {
        const projector = new DefaultStateProjector(tacticsVisibilityRules);
        const snapshot = makeSnapshotFromEntities(buildInitialTacticsEntities([P1, P2]));

        expect(projector.project(snapshot, P1).entities[ENEMY_UNIT]).toBeUndefined();
        expect(projector.project(snapshot, P2).entities[UNIT]).toBeUndefined();

        const payload = tacticsMoveUnitDefinition.parsePayload({
            unitId: UNIT,
            x: TACTICS_INITIAL_UNIT_SPACING_TILES - TACTICS_PROXIMITY_REVEAL_RANGE_TILES,
            y: 0,
        });
        const next = tacticsMoveUnitDefinition.reduce(
            snapshot,
            payload,
            P1,
            makeReduceContext(snapshot),
        );

        const projectedEnemyForMover = projector.project(next, P1).entities[ENEMY_UNIT];
        const projectedMoverForEnemy = projector.project(next, P2).entities[UNIT];

        expect(projectedEnemyForMover).toMatchObject({ id: ENEMY_UNIT, ownerId: P2 });
        expect(projectedEnemyForMover).not.toHaveProperty('visibleTo');
        expect(projectedMoverForEnemy).toMatchObject({ id: UNIT, ownerId: P1 });
        expect(projectedMoverForEnemy).not.toHaveProperty('visibleTo');
    });

    it('moves a unit owned by the dispatcher and advances tick once', () => {
        const snapshot = makeSnapshot();
        const payload = tacticsMoveUnitDefinition.parsePayload({ unitId: UNIT, x: 1, y: 0 });

        const validation = tacticsMoveUnitDefinition.validate(payload, snapshot, P1, {
            rng: createRng(snapshot.seed, snapshot.tick),
            dispatchDepth: 0,
        });
        const next = tacticsMoveUnitDefinition.reduce(
            snapshot,
            payload,
            P1,
            makeReduceContext(snapshot),
        );

        expect(validation).toEqual({ ok: true });
        expect(next.tick).toBe(2);
        expect(next.entities[UNIT]).toMatchObject({ x: 1, y: 0 });
        expect(snapshot.entities[UNIT]).toMatchObject({ x: 0, y: 0 });
        expect(entityVisibleTo(snapshot, ENEMY_UNIT)).toEqual([P2]);
    });

    it('rejects moving an opponent unit', () => {
        const snapshot = makeSnapshot();
        const payload = tacticsMoveUnitDefinition.parsePayload({ unitId: UNIT, x: 1, y: 0 });

        expect(
            tacticsMoveUnitDefinition.validate(payload, snapshot, P2, makeReduceContext(snapshot)),
        ).toEqual({
            ok: false,
            reason: 'not_unit_owner',
        });
    });

    it('does not duplicate an existing proximity reveal viewer', () => {
        const snapshot = makeSnapshot({
            enemyVisibleToP1: true,
            enemyX: TACTICS_PROXIMITY_REVEAL_RANGE_TILES,
        });
        const payload = tacticsMoveUnitDefinition.parsePayload({ unitId: UNIT, x: 0, y: 0 });

        const next = tacticsMoveUnitDefinition.reduce(
            snapshot,
            payload,
            P1,
            makeReduceContext(snapshot),
        );

        expect(entityVisibleTo(next, ENEMY_UNIT)).toEqual([P2, P1]);
    });

    it('compares proximity reveal ranges with squared integer tile distances', () => {
        expect(TACTICS_PROXIMITY_REVEAL_RANGE_TILES_SQUARED).toBe(
            TACTICS_PROXIMITY_REVEAL_RANGE_TILES * TACTICS_PROXIMITY_REVEAL_RANGE_TILES,
        );
        expect(Number.isInteger(TACTICS_PROXIMITY_REVEAL_RANGE_TILES_SQUARED)).toBe(true);

        const snapshot = makeSnapshot({ enemyX: TACTICS_PROXIMITY_REVEAL_RANGE_TILES + 1 });
        const outsidePayload = tacticsMoveUnitDefinition.parsePayload({ unitId: UNIT, x: 0, y: 0 });
        const insidePayload = tacticsMoveUnitDefinition.parsePayload({ unitId: UNIT, x: 1, y: 0 });

        const outside = tacticsMoveUnitDefinition.reduce(
            snapshot,
            outsidePayload,
            P1,
            makeReduceContext(snapshot),
        );
        const inside = tacticsMoveUnitDefinition.reduce(
            snapshot,
            insidePayload,
            P1,
            makeReduceContext(snapshot),
        );

        expect(entityVisibleTo(outside, ENEMY_UNIT)).toEqual([P2]);
        expect(entityVisibleTo(inside, ENEMY_UNIT)).toEqual([P2, P1]);
    });

    it('reveals an adjacent enemy on the targeted tile to the dispatcher and advances tick', () => {
        const snapshot = makeSnapshot();
        const payload = tacticsRevealTileDefinition.parsePayload({ scoutId: UNIT, x: 1, y: 0 });

        const validation = tacticsRevealTileDefinition.validate(
            payload,
            snapshot,
            P1,
            makeReduceContext(snapshot),
        );
        const next = tacticsRevealTileDefinition.reduce(
            snapshot,
            payload,
            P1,
            makeReduceContext(snapshot),
        );

        const revealed = next.entities[ENEMY_UNIT] as unknown as Record<string, unknown>;
        const original = snapshot.entities[ENEMY_UNIT] as unknown as Record<string, unknown>;
        expect(validation).toEqual({ ok: true });
        expect(next.tick).toBe(2);
        expect(revealed['visibleTo']).toEqual([P2, P1]);
        expect(original['visibleTo']).toEqual([P2]);
        expect(next.events[next.events.length - 1]).toMatchObject({
            type: TACTICS_REVEAL_TILE_ACTION,
        });
    });

    it('does not duplicate an existing reveal viewer', () => {
        const snapshot = makeSnapshot();
        const alreadyVisible = {
            ...snapshot,
            entities: {
                ...snapshot.entities,
                [ENEMY_UNIT]: {
                    ...snapshot.entities[ENEMY_UNIT],
                    visibleTo: [P2, P1],
                },
            },
        };
        const payload = tacticsRevealTileDefinition.parsePayload({ scoutId: UNIT, x: 1, y: 0 });

        const next = tacticsRevealTileDefinition.reduce(
            alreadyVisible,
            payload,
            P1,
            makeReduceContext(alreadyVisible),
        );

        expect(
            (next.entities[ENEMY_UNIT] as unknown as Record<string, unknown>)['visibleTo'],
        ).toEqual([P2, P1]);
    });

    it('rejects revealing with an opponent scout', () => {
        const snapshot = makeSnapshot();
        const payload = tacticsRevealTileDefinition.parsePayload({ scoutId: UNIT, x: 1, y: 0 });

        expect(
            tacticsRevealTileDefinition.validate(
                payload,
                snapshot,
                P2,
                makeReduceContext(snapshot),
            ),
        ).toEqual({ ok: false, reason: 'not_scout_owner' });
    });

    it('rejects revealing a non-adjacent tile', () => {
        const snapshot = makeSnapshot();
        const payload = tacticsRevealTileDefinition.parsePayload({ scoutId: UNIT, x: 2, y: 0 });

        expect(
            tacticsRevealTileDefinition.validate(
                payload,
                snapshot,
                P1,
                makeReduceContext(snapshot),
            ),
        ).toEqual({ ok: false, reason: 'target_not_adjacent' });
    });

    it('rejects attacking an unrevealed enemy defender', () => {
        const snapshot = makeSnapshot();
        const payload = tacticsAttackDefinition.parsePayload({
            attackerId: UNIT,
            defenderId: ENEMY_UNIT,
        });

        expect(
            tacticsAttackDefinition.validate(payload, snapshot, P1, makeReduceContext(snapshot)),
        ).toEqual({ ok: false, reason: 'defender_not_visible' });
    });

    it('decrements a revealed adjacent enemy defender by 1 hp and advances tick', () => {
        const snapshot = makeSnapshot({ enemyVisibleToP1: true });
        const payload = tacticsAttackDefinition.parsePayload({
            attackerId: UNIT,
            defenderId: ENEMY_UNIT,
        });

        const validation = tacticsAttackDefinition.validate(payload, snapshot, P1, {
            rng: createRng(snapshot.seed, snapshot.tick),
            dispatchDepth: 0,
        });
        const next = tacticsAttackDefinition.reduce(
            snapshot,
            payload,
            P1,
            makeReduceContext(snapshot),
        );

        expect(validation).toEqual({ ok: true });
        expect(next.tick).toBe(2);
        expect(next.entities[ENEMY_UNIT]).toMatchObject({ hp: 0 });
        expect(snapshot.entities[ENEMY_UNIT]).toMatchObject({ hp: 1 });
    });

    it('clamps defender hp at zero', () => {
        const snapshot = makeSnapshot();
        const defeated = {
            ...snapshot,
            entities: {
                ...snapshot.entities,
                [ENEMY_UNIT]: { ...snapshot.entities[ENEMY_UNIT], hp: 0 },
            },
        };
        const payload = tacticsAttackDefinition.parsePayload({
            attackerId: UNIT,
            defenderId: ENEMY_UNIT,
        });

        const next = tacticsAttackDefinition.reduce(
            defeated,
            payload,
            P1,
            makeReduceContext(defeated),
        );

        expect(next.entities[ENEMY_UNIT]).toMatchObject({ hp: 0 });
    });

    it('rejects attacking with an opponent unit', () => {
        const snapshot = makeSnapshot();
        const payload = tacticsAttackDefinition.parsePayload({
            attackerId: ENEMY_UNIT,
            defenderId: UNIT,
        });

        expect(
            tacticsAttackDefinition.validate(payload, snapshot, P1, makeReduceContext(snapshot)),
        ).toEqual({ ok: false, reason: 'not_attacker_owner' });
    });

    it('registered tactics GameDefinition resolves a winner when enemies are defeated', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();
        registerTacticsActions(registry);
        const definition = registry.resolveGame('tactics');
        const snapshot = makeSnapshot();
        const defeated = {
            ...snapshot,
            entities: {
                ...snapshot.entities,
                [ENEMY_UNIT]: { ...snapshot.entities[ENEMY_UNIT], hp: 0 },
            },
        };

        expect(definition?.resolveGameResult?.(defeated)).toEqual({ winnerIds: [P1] });
    });
});

describe('buildInitialTacticsEntities start positions', () => {
    it('places 4 players at 4 distinct, on-board positions', () => {
        const entities = buildInitialTacticsEntities([P1, P2, P3, P4]);

        expect(Object.keys(entities)).toHaveLength(4);

        const positions = unitPositions(entities);
        // Every unit lands on a valid integer grid cell of the 6×4 board.
        for (const { x, y } of positions) {
            expect(Number.isInteger(x)).toBe(true);
            expect(Number.isInteger(y)).toBe(true);
            expect(x).toBeGreaterThanOrEqual(TACTICS_BOARD_MIN_X);
            expect(x).toBeLessThanOrEqual(TACTICS_BOARD_MAX_X);
            expect(y).toBeGreaterThanOrEqual(TACTICS_BOARD_MIN_Y);
            expect(y).toBeLessThanOrEqual(TACTICS_BOARD_MAX_Y);
        }

        // All four positions are pairwise distinct.
        const distinct = new Set(positions.map(({ x, y }) => `${x},${y}`));
        expect(distinct.size).toBe(4);
    });

    it.each([
        { label: '1 player', roster: [P1] },
        { label: '3 players', roster: [P1, P2, P3] },
    ])('places $label at distinct on-board positions', ({ roster }) => {
        const entities = buildInitialTacticsEntities(roster);

        expect(Object.keys(entities)).toHaveLength(roster.length);

        const positions = unitPositions(entities);
        for (const { x, y } of positions) {
            expect(Number.isInteger(x)).toBe(true);
            expect(Number.isInteger(y)).toBe(true);
            expect(x).toBeGreaterThanOrEqual(TACTICS_BOARD_MIN_X);
            expect(x).toBeLessThanOrEqual(TACTICS_BOARD_MAX_X);
            expect(y).toBeGreaterThanOrEqual(TACTICS_BOARD_MIN_Y);
            expect(y).toBeLessThanOrEqual(TACTICS_BOARD_MAX_Y);
        }

        const distinct = new Set(positions.map(({ x, y }) => `${x},${y}`));
        expect(distinct.size).toBe(roster.length);
    });

    it('keeps the legacy 2-player placement at (0,0) and (2,0)', () => {
        const entities = buildInitialTacticsEntities([P1, P2]);

        expect(entities[UNIT]).toMatchObject({ ownerId: P1, x: 0, y: 0 });
        expect(entities[ENEMY_UNIT]).toMatchObject({ ownerId: P2, x: 2, y: 0 });
    });

    it('throws when the roster exceeds the available start positions', () => {
        const overfullRoster = [P1, P2, P3, P4, playerId('player-5')];

        expect(() => buildInitialTacticsEntities(overfullRoster)).toThrow(
            /exceeds .* start positions/,
        );
    });

    it('is deterministic — the same roster yields identical positions', () => {
        const first = buildInitialTacticsEntities([P1, P2, P3, P4]);
        const second = buildInitialTacticsEntities([P1, P2, P3, P4]);

        expect(second).toEqual(first);
    });

    it('accepts an optional setup argument without changing positions', () => {
        const setup = {
            matchSettings: { boardColor: 'navy' },
            playerAttributes: { [P1]: { color: 'blue' }, [P2]: { color: 'red' } },
        };

        const withSetup = buildInitialTacticsEntities([P1, P2, P3, P4], setup);
        const withoutSetup = buildInitialTacticsEntities([P1, P2, P3, P4]);

        expect(withSetup).toEqual(withoutSetup);
    });
});
