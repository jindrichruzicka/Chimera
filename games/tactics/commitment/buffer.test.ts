// games/tactics/commitment/buffer.test.ts
//
// Unit tests for the pure local-action-buffer kernel (T8 / #728). In commitment
// turn mode a player's move/attack/reveal selections are buffered locally and
// applied to an optimistic view (spending local stamina) instead of being
// dispatched to the host. Undo pops the buffer and refunds stamina exactly by
// recomputing the view from the shortened buffer.
//
// Design note: docs/security-trust/tactics-commitment-battle-mode.md §2, §6

import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera/shared/tactics.js';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
} from '@chimera/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera/simulation/engine/types.js';
import { describe, expect, it } from 'vitest';

import { tacticsGridCoordinate } from '../actions.js';
import { readStamina, type TacticsSnapshot } from '../stamina.js';
import type { BufferedTacticsAction } from './contract.js';
import { appendToBuffer, applyBuffer, bufferCanUndo, popBuffer } from './buffer.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');
const UNIT = entityId('unit-1');
const ENEMY = entityId('unit-2');

function makeBase(): TacticsSnapshot {
    const unit = {
        id: UNIT,
        kind: 'unit',
        ownerId: P1,
        x: tacticsGridCoordinate(0),
        y: tacticsGridCoordinate(0),
        hp: 1,
        visibleTo: [P1],
    } satisfies BaseEntityState & Record<string, unknown>;
    const enemy = {
        id: ENEMY,
        kind: 'unit',
        ownerId: P2,
        x: tacticsGridCoordinate(1),
        y: tacticsGridCoordinate(0),
        hp: 1,
        visibleTo: [P2, P1],
    } satisfies BaseEntityState & Record<string, unknown>;
    return {
        tick: 1,
        seed: 42,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: { [UNIT]: unit, [ENEMY]: enemy } as Record<EntityId, BaseEntityState>,
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: P1,
        turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
        timers: {},
        gameResult: null,
    } satisfies BaseGameSnapshot;
}

const moveTo = (x: number, y: number): BufferedTacticsAction => ({
    type: TACTICS_MOVE_UNIT_ACTION,
    payload: { unitId: UNIT, x: tacticsGridCoordinate(x), y: tacticsGridCoordinate(y) },
});

const revealAt = (x: number, y: number): BufferedTacticsAction => ({
    type: TACTICS_REVEAL_TILE_ACTION,
    payload: { scoutId: UNIT, x: tacticsGridCoordinate(x), y: tacticsGridCoordinate(y) },
});

const attackEnemy: BufferedTacticsAction = {
    type: TACTICS_ATTACK_ACTION,
    payload: { attackerId: UNIT, defenderId: ENEMY },
};

describe('applyBuffer', () => {
    it('returns an equivalent view (full stamina) for an empty buffer', () => {
        const base = makeBase();

        const view = applyBuffer(base, [], P1);

        expect(readStamina(view, P1).current).toBe(3);
        expect(view.entities[UNIT]).toMatchObject({ x: 0, y: 0 });
    });

    it('applies a move to the optimistic view and spends one local stamina', () => {
        const base = makeBase();

        const view = applyBuffer(base, [moveTo(0, 1)], P1);

        expect(view.entities[UNIT]).toMatchObject({ x: 0, y: 1 });
        expect(readStamina(view, P1).current).toBe(2);
    });

    it('does not mutate the base snapshot', () => {
        const base = makeBase();

        applyBuffer(base, [moveTo(0, 1), attackEnemy], P1);

        expect(base.entities[UNIT]).toMatchObject({ x: 0, y: 0 });
        expect(readStamina(base, P1).current).toBe(3);
    });

    it('does not change stamina for a reveal action', () => {
        const base = makeBase();

        const view = applyBuffer(base, [revealAt(0, 1)], P1);

        expect(readStamina(view, P1).current).toBe(3);
    });
});

describe('appendToBuffer', () => {
    it('appends a legal action validated against the current optimistic view', () => {
        const base = makeBase();

        const result = appendToBuffer(base, [], moveTo(0, 1), P1);

        expect(result).toEqual({ ok: true, buffer: [moveTo(0, 1)] });
    });

    it('rejects a move once local stamina is exhausted', () => {
        const base = makeBase();
        let buffer: readonly BufferedTacticsAction[] = [];
        for (const step of [moveTo(0, 1), moveTo(0, 2), moveTo(0, 3)]) {
            const r = appendToBuffer(base, buffer, step, P1);
            expect(r.ok).toBe(true);
            if (r.ok) buffer = r.buffer;
        }

        const fourth = appendToBuffer(base, buffer, moveTo(0, 4), P1);

        expect(fourth).toEqual({ ok: false, reason: 'insufficient_stamina' });
    });

    it('rejects an illegal action with the reducer reason', () => {
        const base = makeBase();
        // P1 cannot move a unit it does not own.
        const enemyMove: BufferedTacticsAction = {
            type: TACTICS_MOVE_UNIT_ACTION,
            payload: { unitId: ENEMY, x: tacticsGridCoordinate(2), y: tacticsGridCoordinate(0) },
        };

        const result = appendToBuffer(base, [], enemyMove, P1);

        expect(result).toEqual({ ok: false, reason: 'not_unit_owner' });
    });
});

describe('popBuffer / bufferCanUndo (undo before commit + stamina refund)', () => {
    it('refunds exactly one stamina when popping a move', () => {
        const base = makeBase();
        const twoMoves = [moveTo(0, 1), moveTo(0, 2)];

        const popped = popBuffer(twoMoves);

        expect(popped).toEqual([moveTo(0, 1)]);
        expect(readStamina(applyBuffer(base, popped, P1), P1).current).toBe(2);
        expect(readStamina(applyBuffer(base, twoMoves, P1), P1).current).toBe(1);
    });

    it('refunds zero stamina when popping a reveal', () => {
        const base = makeBase();
        const buffer = [moveTo(0, 1), revealAt(0, 2)];

        const popped = popBuffer(buffer);

        expect(readStamina(applyBuffer(base, buffer, P1), P1).current).toBe(2);
        expect(readStamina(applyBuffer(base, popped, P1), P1).current).toBe(2);
    });

    it('never refunds above max stamina', () => {
        const base = makeBase();

        const popped = popBuffer([moveTo(0, 1)]);

        expect(popped).toEqual([]);
        expect(readStamina(applyBuffer(base, popped, P1), P1).current).toBe(3);
    });

    it('reports can-undo from buffer length only', () => {
        expect(bufferCanUndo([])).toBe(false);
        expect(bufferCanUndo([moveTo(0, 1)])).toBe(true);
    });

    it('popping an empty buffer is a no-op', () => {
        expect(popBuffer([])).toEqual([]);
    });
});
