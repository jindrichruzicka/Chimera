import { describe, expect, it } from 'vitest';
import { TACTICS_MAX_STAMINA } from '@chimera/shared/tactics.js';
import type { BaseGameSnapshot, PlayerId } from '@chimera/simulation/engine/types.js';
import { gamePhase, playerId } from '@chimera/simulation/engine/types.js';
import type { TacticsStaminaEntry, TacticsSnapshot } from './stamina.js';
import { consumeStamina, readStamina, withSeededStamina } from './stamina.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');

function makeSnapshot(
    options: {
        readonly activePlayerId?: PlayerId;
        readonly turnNumber?: number;
        readonly playerStamina?: Readonly<Record<PlayerId, TacticsStaminaEntry>>;
    } = {},
): TacticsSnapshot {
    const base: BaseGameSnapshot = {
        tick: 1,
        seed: 42,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: options.turnNumber ?? 0,
        hostPlayerId: P1,
        turnClock: { activePlayerId: options.activePlayerId ?? P1, deadlineMs: 30_000 },
        timers: {},
        gameResult: null,
    };
    return options.playerStamina === undefined
        ? base
        : { ...base, playerStamina: options.playerStamina };
}

describe('readStamina', () => {
    it('seeds an absent player at full stamina (derived start-of-game default)', () => {
        const state = makeSnapshot();

        expect(readStamina(state, P1)).toEqual({
            current: TACTICS_MAX_STAMINA,
            max: TACTICS_MAX_STAMINA,
        });
    });

    it('returns the stored current while the player is still acting this turn', () => {
        const state = makeSnapshot({
            activePlayerId: P1,
            turnNumber: 0,
            playerStamina: { [P1]: { current: 1, max: 3, refreshedTurn: 0 } },
        });

        expect(readStamina(state, P1)).toEqual({ current: 1, max: 3 });
    });

    it('refreshes to max when the player turn begins again on a later turn', () => {
        const state = makeSnapshot({
            activePlayerId: P1,
            turnNumber: 2,
            playerStamina: { [P1]: { current: 0, max: 3, refreshedTurn: 0 } },
        });

        expect(readStamina(state, P1)).toEqual({ current: 3, max: 3 });
    });

    it('does not refresh another player while it is not their turn', () => {
        const state = makeSnapshot({
            activePlayerId: P2,
            turnNumber: 1,
            playerStamina: { [P1]: { current: 1, max: 3, refreshedTurn: 0 } },
        });

        expect(readStamina(state, P1)).toEqual({ current: 1, max: 3 });
    });
});

describe('consumeStamina', () => {
    it('spends one from the effective value, stamps the turn, and does not mutate input', () => {
        const ledger = { [P1]: { current: 2, max: 3, refreshedTurn: 0 } };
        const state = makeSnapshot({ activePlayerId: P1, turnNumber: 0, playerStamina: ledger });

        const next = consumeStamina(state, P1);

        expect(next[P1]).toEqual({ current: 1, max: 3, refreshedTurn: 0 });
        expect(ledger[P1]).toEqual({ current: 2, max: 3, refreshedTurn: 0 });
    });

    it('refreshes before spending on the first action of a new turn', () => {
        const state = makeSnapshot({
            activePlayerId: P1,
            turnNumber: 2,
            playerStamina: { [P1]: { current: 0, max: 3, refreshedTurn: 0 } },
        });

        expect(consumeStamina(state, P1)[P1]).toEqual({
            current: TACTICS_MAX_STAMINA - 1,
            max: 3,
            refreshedTurn: 2,
        });
    });

    it('floors at zero and never goes negative', () => {
        const state = makeSnapshot({
            activePlayerId: P1,
            turnNumber: 0,
            playerStamina: { [P1]: { current: 0, max: 3, refreshedTurn: 0 } },
        });

        expect(consumeStamina(state, P1)[P1]?.current).toBe(0);
    });

    it('seeds then spends for a player with no prior ledger entry', () => {
        const state = makeSnapshot();

        expect(consumeStamina(state, P1)[P1]).toEqual({
            current: TACTICS_MAX_STAMINA - 1,
            max: TACTICS_MAX_STAMINA,
            refreshedTurn: 0,
        });
    });
});

describe('withSeededStamina', () => {
    it('seeds every listed player at full stamina by default without mutating input', () => {
        const state = makeSnapshot();

        const seeded = withSeededStamina(state, [P1, P2]);

        expect(readStamina(seeded, P1)).toEqual({
            current: TACTICS_MAX_STAMINA,
            max: TACTICS_MAX_STAMINA,
        });
        expect(readStamina(seeded, P2)).toEqual({
            current: TACTICS_MAX_STAMINA,
            max: TACTICS_MAX_STAMINA,
        });
        expect(state.playerStamina).toBeUndefined();
    });

    it('seeds an explicit amount as both current and max', () => {
        const seeded = withSeededStamina(makeSnapshot(), [P1], 1_000);

        expect(readStamina(seeded, P1)).toEqual({ current: 1_000, max: 1_000 });
    });
});
