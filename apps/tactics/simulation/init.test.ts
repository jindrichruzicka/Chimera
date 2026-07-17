import { describe, expect, it } from 'vitest';
import { playerId } from '@chimera-engine/simulation/engine/types.js';
import { resolveTacticsFirstPlayer } from './init.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');

describe('resolveTacticsFirstPlayer', () => {
    it('defaults the initial first player to the host player', () => {
        expect(resolveTacticsFirstPlayer({ hostPlayerId: P1 })).toBe(P1);
    });

    it('uses an explicit first player from Tactics initialization config', () => {
        expect(resolveTacticsFirstPlayer({ hostPlayerId: P1, firstPlayer: P2 })).toBe(P2);
    });
});
