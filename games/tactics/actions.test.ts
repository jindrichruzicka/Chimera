import { describe, expect, it } from 'vitest';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { createRng } from '@chimera/simulation/engine/DeterministicRng.js';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    GameReduceContext,
} from '@chimera/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera/simulation/engine/types.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    registerTacticsActions,
    resolveTacticsFirstPlayer,
    tacticsAttackDefinition,
    tacticsGridCoordinate,
    tacticsMoveUnitDefinition,
} from './actions.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');
const UNIT = entityId('unit-1');
const ENEMY_UNIT = entityId('unit-2');

function makeSnapshot(): BaseGameSnapshot {
    const unit = {
        id: UNIT,
        kind: 'unit',
        ownerId: P1,
        x: 0,
        y: 0,
        hp: 1,
    } satisfies BaseEntityState & {
        readonly kind: 'unit';
        readonly ownerId: typeof P1;
        readonly x: number;
        readonly y: number;
        readonly hp: number;
    };
    const enemyUnit = {
        id: ENEMY_UNIT,
        kind: 'unit',
        ownerId: P2,
        x: 1,
        y: 0,
        hp: 1,
    } satisfies BaseEntityState & {
        readonly kind: 'unit';
        readonly ownerId: typeof P2;
        readonly x: number;
        readonly y: number;
        readonly hp: number;
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
        matchResult: null,
    };
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

    it('exports and registers the attack action for deterministic match resolution', () => {
        const registry = new ActionRegistry();

        registerTacticsActions(registry);

        expect(TACTICS_ATTACK_ACTION).toBe('tactics:attack');
        expect(registry.has(TACTICS_ATTACK_ACTION)).toBe(true);
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

    it('decrements an adjacent enemy defender by 1 hp and advances tick', () => {
        const snapshot = makeSnapshot();
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

        expect(definition?.resolveMatchResult?.(defeated)).toEqual({ winnerIds: [P1] });
    });
});
