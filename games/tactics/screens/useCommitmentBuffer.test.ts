// games/tactics/screens/useCommitmentBuffer.test.ts
//
// Unit tests for the renderer-side commitment buffer store (F54 / #730). The
// store shares the per-turn local action buffer between the board (which appends
// and renders the optimistic view) and the HUD (Commit / Undo / optimistic
// stamina). It reuses the pure kernel (`../commitment/buffer`) for all rules; the
// store only holds state and a "committed" latch and resets per turn / match.

import { TACTICS_MOVE_UNIT_ACTION } from '@chimera/shared/tactics.js';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
} from '@chimera/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera/simulation/engine/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { tacticsGridCoordinate } from '../actions.js';
import type { TacticsSnapshot } from '../stamina.js';
import type { BufferedTacticsAction } from '../commitment/contract.js';
import {
    selectBuffer,
    selectCanUndo,
    selectCommittedLatch,
    toOptimisticBase,
    useCommitmentBuffer,
} from './useCommitmentBuffer.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');
const UNIT = entityId('unit-1');

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
    return {
        tick: 1,
        seed: 42,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: { [UNIT]: unit } as Record<EntityId, BaseEntityState>,
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

afterEach(() => {
    useCommitmentBuffer.getState().reset();
});

describe('useCommitmentBuffer store', () => {
    it('append grows the buffer for a legal action (via the kernel)', () => {
        const result = useCommitmentBuffer.getState().append(makeBase(), moveTo(0, 1), P1);

        expect(result.ok).toBe(true);
        expect(selectBuffer(useCommitmentBuffer.getState())).toHaveLength(1);
        expect(selectCanUndo(useCommitmentBuffer.getState())).toBe(true);
    });

    it('append rejects an illegal action and leaves the buffer unchanged', () => {
        // Moving a unit the player does not own is rejected by the move reducer's
        // validate (reused by the kernel) — proving the optimistic buffer enforces
        // the same rules as the host.
        const illegalMove: BufferedTacticsAction = {
            type: TACTICS_MOVE_UNIT_ACTION,
            payload: {
                unitId: entityId('does-not-exist'),
                x: tacticsGridCoordinate(0),
                y: tacticsGridCoordinate(1),
            },
        };
        const result = useCommitmentBuffer.getState().append(makeBase(), illegalMove, P1);

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('unit_not_found');
        expect(selectBuffer(useCommitmentBuffer.getState())).toHaveLength(0);
    });

    it('undo pops the last buffered action', () => {
        const store = useCommitmentBuffer.getState();
        store.append(makeBase(), moveTo(0, 1), P1);
        store.append(makeBase(), moveTo(1, 1), P1); // (0,1) → (1,1), both in bounds
        expect(selectBuffer(useCommitmentBuffer.getState())).toHaveLength(2);

        useCommitmentBuffer.getState().undo();

        expect(selectBuffer(useCommitmentBuffer.getState())).toHaveLength(1);
    });

    it('markCommitted latches and blocks further append/undo', () => {
        const store = useCommitmentBuffer.getState();
        store.append(makeBase(), moveTo(0, 1), P1);
        store.markCommitted();

        expect(selectCommittedLatch(useCommitmentBuffer.getState())).toBe(true);
        const blocked = useCommitmentBuffer.getState().append(makeBase(), moveTo(0, 2), P1);
        expect(blocked.ok).toBe(false);
        useCommitmentBuffer.getState().undo();
        expect(selectBuffer(useCommitmentBuffer.getState())).toHaveLength(1); // unchanged
    });

    it('reset clears the buffer and the committed latch (turn / match boundary)', () => {
        const store = useCommitmentBuffer.getState();
        store.append(makeBase(), moveTo(0, 1), P1);
        store.markCommitted();

        useCommitmentBuffer.getState().reset();

        expect(selectBuffer(useCommitmentBuffer.getState())).toHaveLength(0);
        expect(selectCommittedLatch(useCommitmentBuffer.getState())).toBe(false);
    });
});

describe('toOptimisticBase', () => {
    it('normalises a PlayerSnapshot into a reducer-safe base (seed, turnNumber, timers)', () => {
        const snapshot = {
            tick: 7,
            viewerId: P1,
            phase: gamePhase('playing'),
            players: {},
            entities: {},
            events: [],
            gameResult: null,
            commitments: {},
            undoMeta: { canUndo: false, canRedo: false },
            isMyTurn: true,
        } as unknown as Parameters<typeof toOptimisticBase>[0];

        const base = toOptimisticBase(snapshot);

        expect(base.seed).toBe(7); // derived from tick — reducers don't read ctx.rng
        expect(base.turnNumber).toBe(0);
        expect(base.timers).toEqual({});
    });
});
