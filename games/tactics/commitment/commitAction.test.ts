// games/tactics/commitment/commitAction.test.ts
//
// Unit tests for the `tactics:commit` marker action (T8 / #728). Its reducer
// records ONLY the non-secret "player X committed for turn N" marker into
// `snapshot.committedTurns` — never the player's buffered actions, which stay
// host-local in the reveal-staging store (Invariants #3/#8). The end-turn guard
// reads the marker to gate `engine:end_turn` until every seat has committed.

import { TACTICS_TURN_MODE_SETTING } from '@chimera/games/tactics/constants.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    GameReduceContext,
    ValidationResult,
} from '@chimera/simulation/engine/types.js';
import { createRng } from '@chimera/simulation/engine/DeterministicRng.js';
import { entityId, gamePhase, playerId } from '@chimera/simulation/engine/types.js';
import { describe, expect, it } from 'vitest';

import { registerTacticsActions, tacticsGridCoordinate } from '../actions.js';
import { tacticsCommitDefinition } from './commitAction.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');
const OUTSIDER = playerId('player-9');
const UNIT = entityId('unit-1');

function makeSnapshot(turnMode = 'commitment'): BaseGameSnapshot {
    return {
        tick: 5,
        seed: 42,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: {
            [UNIT]: {
                id: UNIT,
                kind: 'unit',
                ownerId: P1,
                x: tacticsGridCoordinate(0),
                y: tacticsGridCoordinate(0),
                hp: 1,
            } as BaseEntityState,
        },
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 3,
        turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
        timers: {},
        gameResult: null,
        setup: { matchSettings: { [TACTICS_TURN_MODE_SETTING]: turnMode }, playerAttributes: {} },
    };
}

const ctx = (snapshot: BaseGameSnapshot): GameReduceContext => ({
    rng: createRng(snapshot.seed, snapshot.tick),
    dispatchDepth: 0,
});

describe('tactics:commit validate', () => {
    it('accepts a seated player in commitment mode', () => {
        const snapshot = makeSnapshot('commitment');
        expect(tacticsCommitDefinition.validate({}, snapshot, P1, ctx(snapshot))).toEqual({
            ok: true,
        });
    });

    it('rejects when the match is not in commitment mode', () => {
        const snapshot = makeSnapshot('sequential');
        expect(tacticsCommitDefinition.validate({}, snapshot, P1, ctx(snapshot))).toEqual({
            ok: false,
            reason: 'not_commitment_mode',
        });
    });

    it('rejects a player who is not seated in the game', () => {
        const snapshot = makeSnapshot('commitment');
        expect(tacticsCommitDefinition.validate({}, snapshot, OUTSIDER, ctx(snapshot))).toEqual({
            ok: false,
            reason: 'not_in_game',
        });
    });
});

describe('tactics:commit parsePayload', () => {
    it('strips the buffer rider so the actions never reach reduce or the snapshot', () => {
        // In commitment mode the player's buffer rides the raw `tactics:commit`
        // envelope to the host, which stages it out-of-band (Invariants #3/#8).
        // parsePayload must drop it so it can never land on the snapshot.
        const parsed = tacticsCommitDefinition.parsePayload({
            actions: [{ type: 'tactics:move_unit', payload: { unitId: 'unit-1', x: 1, y: 0 } }],
        });
        expect(parsed).toEqual({});
    });
});

describe('tactics:commit reduce', () => {
    it('marks only the acting player as committed for the current turn', () => {
        const snapshot = makeSnapshot('commitment');

        const next = tacticsCommitDefinition.reduce(snapshot, {}, P1, ctx(snapshot));

        expect(next.committedTurns).toEqual({ [P1]: 3 });
        expect(next.tick).toBe(6);
    });

    it('preserves earlier committers and never stores buffered actions', () => {
        const snapshot = { ...makeSnapshot('commitment'), committedTurns: { [P2]: 3 } };

        const next = tacticsCommitDefinition.reduce(snapshot, {}, P1, ctx(snapshot));

        expect(next.committedTurns).toEqual({ [P1]: 3, [P2]: 3 });
        // No "actions" leaked anywhere on the snapshot.
        expect(JSON.stringify(next)).not.toContain('"actions"');
        // Entities / other state untouched.
        expect(next.entities).toBe(snapshot.entities);
    });

    it('does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot('commitment');

        tacticsCommitDefinition.reduce(snapshot, {}, P1, ctx(snapshot));

        expect(snapshot.committedTurns).toBeUndefined();
        expect(snapshot.tick).toBe(5);
    });
});

describe('tactics canEndTurn registry hook', () => {
    function canEndTurn(snapshot: BaseGameSnapshot, player = P1): ValidationResult {
        const registry = new ActionRegistry();
        registerTacticsActions(registry);
        const guard = registry.resolveGame('tactics')?.canEndTurn;
        if (guard === undefined) throw new Error('tactics canEndTurn not registered');
        return guard(snapshot, player);
    }

    it('always allows end-turn in sequential mode', () => {
        expect(canEndTurn(makeSnapshot('sequential'))).toEqual({ ok: true });
    });

    it('blocks end-turn in commitment mode until every seat has committed', () => {
        const snapshot = makeSnapshot('commitment');
        expect(canEndTurn(snapshot)).toEqual({ ok: false, reason: 'awaiting_commitment' });
    });

    it('still blocks when only some seats have committed', () => {
        const snapshot = { ...makeSnapshot('commitment'), committedTurns: { [P1]: 3 } };
        expect(canEndTurn(snapshot)).toEqual({ ok: false, reason: 'awaiting_commitment' });
    });

    it('allows end-turn once all seats are committed for the current turn', () => {
        const snapshot = { ...makeSnapshot('commitment'), committedTurns: { [P1]: 3, [P2]: 3 } };
        expect(canEndTurn(snapshot)).toEqual({ ok: true });
    });

    it('treats commitments for a prior turn as stale (blocks)', () => {
        const snapshot = { ...makeSnapshot('commitment'), committedTurns: { [P1]: 2, [P2]: 2 } };
        expect(canEndTurn(snapshot)).toEqual({ ok: false, reason: 'awaiting_commitment' });
    });
});
