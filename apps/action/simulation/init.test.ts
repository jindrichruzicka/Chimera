import { describe, expect, it } from 'vitest';
import { playerId } from '@chimera-engine/simulation/engine/types.js';

import { resolveActionFirstPlayer } from './init.js';

const HOST = playerId('host');
const GUEST = playerId('guest');

describe('resolveActionFirstPlayer', () => {
    it('seats the explicitly configured first player', () => {
        expect(resolveActionFirstPlayer({ hostPlayerId: HOST, firstPlayer: GUEST })).toBe(GUEST);
    });

    it('falls back to the host when no first player is configured', () => {
        expect(resolveActionFirstPlayer({ hostPlayerId: HOST })).toBe(HOST);
    });
});
