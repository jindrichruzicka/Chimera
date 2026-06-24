import { describe, expect, it } from 'vitest';
import { TACTICS_TURN_MODE_SETTING } from '@chimera/tactics/constants.js';
import type { BaseGameSnapshot, PlayerId } from '@chimera/simulation/engine/types.js';
import { gamePhase, playerId } from '@chimera/simulation/engine/types.js';
import {
    allSeatsCommitted,
    hasCommittedThisTurn,
    isTacticsCommitmentMode,
    tacticsMayEndTurn,
    tacticsResolveIsMyTurn,
} from './turnGate.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');

function makeSnapshot(
    options: {
        readonly turnMode?: 'commitment' | 'sequential';
        readonly activePlayerId?: PlayerId;
        readonly turnNumber?: number;
        readonly committedTurns?: Readonly<Record<PlayerId, number>>;
        readonly players?: Readonly<Record<PlayerId, { readonly id: PlayerId }>>;
    } = {},
): BaseGameSnapshot {
    const base: BaseGameSnapshot = {
        tick: 1,
        seed: 42,
        players: options.players ?? { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: options.turnNumber ?? 0,
        hostPlayerId: P1,
        turnClock: { activePlayerId: options.activePlayerId ?? P1, deadlineMs: 30_000 },
        timers: {},
        gameResult: null,
        ...(options.turnMode === undefined
            ? {}
            : {
                  setup: {
                      matchSettings: { [TACTICS_TURN_MODE_SETTING]: options.turnMode },
                      playerAttributes: {},
                  },
              }),
        ...(options.committedTurns === undefined ? {} : { committedTurns: options.committedTurns }),
    };
    return base;
}

describe('isTacticsCommitmentMode', () => {
    it('is true only when matchSettings.turnMode === commitment', () => {
        expect(isTacticsCommitmentMode(makeSnapshot({ turnMode: 'commitment' }))).toBe(true);
        expect(isTacticsCommitmentMode(makeSnapshot({ turnMode: 'sequential' }))).toBe(false);
        expect(isTacticsCommitmentMode(makeSnapshot())).toBe(false);
    });
});

describe('hasCommittedThisTurn / allSeatsCommitted', () => {
    it('hasCommittedThisTurn matches only the current turnNumber', () => {
        const state = makeSnapshot({ turnNumber: 3, committedTurns: { [P1]: 3, [P2]: 2 } });
        expect(hasCommittedThisTurn(state, P1)).toBe(true);
        expect(hasCommittedThisTurn(state, P2)).toBe(false); // stale (turn 2)
    });

    it('allSeatsCommitted requires every seat at the current turnNumber', () => {
        expect(
            allSeatsCommitted(
                makeSnapshot({ turnNumber: 1, committedTurns: { [P1]: 1, [P2]: 1 } }),
            ),
        ).toBe(true);
        expect(
            allSeatsCommitted(makeSnapshot({ turnNumber: 1, committedTurns: { [P1]: 1 } })),
        ).toBe(false);
    });
});

describe('tacticsResolveIsMyTurn', () => {
    it('sequential mode: only the active player is active', () => {
        const state = makeSnapshot({ turnMode: 'sequential', activePlayerId: P1 });
        expect(tacticsResolveIsMyTurn(state, P1)).toBe(true);
        expect(tacticsResolveIsMyTurn(state, P2)).toBe(false);
    });

    it('commitment mode: every seated, not-yet-committed player is active in parallel', () => {
        const state = makeSnapshot({ turnMode: 'commitment', turnNumber: 1, activePlayerId: P1 });
        // Neither has committed for turn 1 → both interactive simultaneously.
        expect(tacticsResolveIsMyTurn(state, P1)).toBe(true);
        expect(tacticsResolveIsMyTurn(state, P2)).toBe(true);
    });

    it('commitment mode: a committed seat becomes inert while the other stays active', () => {
        const state = makeSnapshot({
            turnMode: 'commitment',
            turnNumber: 1,
            committedTurns: { [P1]: 1 },
        });
        expect(tacticsResolveIsMyTurn(state, P1)).toBe(false); // committed → inert
        expect(tacticsResolveIsMyTurn(state, P2)).toBe(true); // still acting
    });

    it('commitment mode: a non-seated viewer is never active', () => {
        const state = makeSnapshot({
            turnMode: 'commitment',
            players: { [P1]: { id: P1 } },
        });
        expect(tacticsResolveIsMyTurn(state, P2)).toBe(false);
    });
});

describe('tacticsMayEndTurn', () => {
    it('sequential mode: only the active player may end the turn', () => {
        const state = makeSnapshot({ turnMode: 'sequential', activePlayerId: P1 });
        expect(tacticsMayEndTurn(state, P1)).toBe(true);
        expect(tacticsMayEndTurn(state, P2)).toBe(false);
    });

    it('commitment mode: blocked until every seat has committed', () => {
        const partial = makeSnapshot({
            turnMode: 'commitment',
            turnNumber: 1,
            committedTurns: { [P1]: 1 },
        });
        expect(tacticsMayEndTurn(partial, P1)).toBe(false);
        expect(tacticsMayEndTurn(partial, P2)).toBe(false);
    });

    it('commitment mode: once all committed, any seated player may end the turn', () => {
        const all = makeSnapshot({
            turnMode: 'commitment',
            turnNumber: 1,
            committedTurns: { [P1]: 1, [P2]: 1 },
        });
        expect(tacticsMayEndTurn(all, P1)).toBe(true);
        expect(tacticsMayEndTurn(all, P2)).toBe(true);
    });
});
