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
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_DEFAULT_UNIT_ID,
    registerTacticsActions,
    tacticsGridCoordinate,
    tacticsMoveUnitDefinition,
} from './actions.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');
const UNIT = entityId('unit-1');

function makeSnapshot(): BaseGameSnapshot {
    const unit = { id: UNIT, kind: 'unit', ownerId: P1, x: 0, y: 0 } satisfies BaseEntityState & {
        readonly kind: 'unit';
        readonly ownerId: typeof P1;
        readonly x: number;
        readonly y: number;
    };
    return {
        tick: 1,
        seed: 42,
        players: {
            [P1]: { id: P1 },
            [P2]: { id: P2 },
        },
        entities: { [UNIT]: unit },
        phase: gamePhase('ended'),
        events: [],
        turnNumber: 0,
        hostPlayerId: P1,
        turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
        timers: {},
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

    it('registers a GameDefinition that builds the initial tactics entities', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();

        registerTacticsActions(registry);

        const definition = registry.resolveGame('tactics');
        const initialEntities = definition?.buildInitialEntities?.(P1);

        expect(initialEntities?.[TACTICS_DEFAULT_UNIT_ID]).toMatchObject({
            id: TACTICS_DEFAULT_UNIT_ID,
            kind: 'unit',
            ownerId: P1,
            x: 0,
            y: 0,
        });
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
});
