// games/tactics/commitment/contract.test.ts
//
// Unit test for the one pure helper in the commitment battle-mode contract:
// `bufferHasAttack`, which derives the `CommittedTurn.hasAttack` discriminant
// the deterministic reveal order groups on (attack-committers reveal first).
//
// Design note: docs/security-trust/tactics-commitment-battle-mode.md

import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera/shared/tactics.js';
import { entityId } from '@chimera/simulation/engine/types.js';
import { describe, expect, it } from 'vitest';

import { tacticsGridCoordinate } from '../actions.js';
import { bufferHasAttack, type BufferedTacticsAction } from './contract.js';

const move: BufferedTacticsAction = {
    type: TACTICS_MOVE_UNIT_ACTION,
    payload: {
        unitId: entityId('unit-1'),
        x: tacticsGridCoordinate(1),
        y: tacticsGridCoordinate(0),
    },
};

const reveal: BufferedTacticsAction = {
    type: TACTICS_REVEAL_TILE_ACTION,
    payload: {
        scoutId: entityId('unit-1'),
        x: tacticsGridCoordinate(1),
        y: tacticsGridCoordinate(1),
    },
};

const attack: BufferedTacticsAction = {
    type: TACTICS_ATTACK_ACTION,
    payload: {
        attackerId: entityId('unit-1'),
        defenderId: entityId('unit-2'),
    },
};

describe('bufferHasAttack (T6 / #726 — reveal-order discriminant)', () => {
    it('is false for an empty buffer', () => {
        expect(bufferHasAttack([])).toBe(false);
    });

    it('is false for a buffer of only non-attack actions', () => {
        expect(bufferHasAttack([move, reveal, move])).toBe(false);
    });

    it('is true when the buffer contains an attack', () => {
        expect(bufferHasAttack([attack])).toBe(true);
    });

    it('is true when an attack is mixed with non-attack actions', () => {
        expect(bufferHasAttack([move, attack, reveal])).toBe(true);
    });
});
