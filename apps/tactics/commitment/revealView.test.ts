// apps/tactics/commitment/revealView.test.ts
//
// Unit tests for the renderer-side reveal narrowing (T9 / #729). The tactics
// board uses `parseRevealedTurn` to turn an opaque verified reveal into the
// committed turn it animates; malformed or absent reveals yield null.

import { TACTICS_MOVE_UNIT_ACTION } from '@chimera/tactics/constants.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import { describe, expect, it } from 'vitest';

import { parseRevealedTurn } from './revealView.js';

const P1 = toPlayerId('player-1');

describe('parseRevealedTurn (T9 / #729)', () => {
    it('returns null for an absent reveal', () => {
        expect(parseRevealedTurn(null)).toBeNull();
        expect(parseRevealedTurn(undefined)).toBeNull();
    });

    it('narrows a valid reveal value to the committed turn', () => {
        const reveal = {
            value: {
                playerId: P1,
                turnNumber: 4,
                actions: [
                    { type: TACTICS_MOVE_UNIT_ACTION, payload: { unitId: 'u1', x: 1, y: 0 } },
                ],
            },
        };
        const turn = parseRevealedTurn(reveal);
        expect(turn?.playerId).toBe(P1);
        expect(turn?.turnNumber).toBe(4);
        expect(turn?.actions).toHaveLength(1);
    });

    it('returns null for a malformed reveal value', () => {
        expect(parseRevealedTurn({ value: { nope: true } })).toBeNull();
        expect(parseRevealedTurn({ value: 'not-an-object' })).toBeNull();
    });
});
