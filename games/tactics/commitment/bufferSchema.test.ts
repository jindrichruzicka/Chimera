// games/tactics/commitment/bufferSchema.test.ts
//
// Unit tests for the committed-buffer trust boundary (T9 / #729). These schemas
// validate the untrusted buffer that rides the tactics:commit envelope before
// the host stages it for reveal, so every rejection branch matters.

import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera/games/tactics/constants.js';
import { describe, expect, it } from 'vitest';

import {
    BufferedTacticsActionSchema,
    LocalActionBufferSchema,
    MAX_COMMITTED_BUFFER_ACTIONS,
    TacticsCommitmentEnvelopeValueSchema,
} from './bufferSchema.js';

const move = { type: TACTICS_MOVE_UNIT_ACTION, payload: { unitId: 'u1', x: 1, y: 0 } };
const attack = { type: TACTICS_ATTACK_ACTION, payload: { attackerId: 'u1', defenderId: 'u2' } };
const revealTile = { type: TACTICS_REVEAL_TILE_ACTION, payload: { scoutId: 'u1', x: 2, y: 3 } };

describe('BufferedTacticsActionSchema', () => {
    it('accepts each of the three bufferable action variants', () => {
        for (const action of [move, attack, revealTile]) {
            expect(BufferedTacticsActionSchema.safeParse(action).success).toBe(true);
        }
    });

    it('rejects an unknown action type', () => {
        expect(
            BufferedTacticsActionSchema.safeParse({ type: 'tactics:bogus', payload: {} }).success,
        ).toBe(false);
    });

    it('rejects a non-integer grid coordinate', () => {
        expect(
            BufferedTacticsActionSchema.safeParse({
                type: TACTICS_MOVE_UNIT_ACTION,
                payload: { unitId: 'u1', x: 1.5, y: 0 },
            }).success,
        ).toBe(false);
    });

    it('rejects an empty entity id', () => {
        expect(
            BufferedTacticsActionSchema.safeParse({
                type: TACTICS_ATTACK_ACTION,
                payload: { attackerId: '', defenderId: 'u2' },
            }).success,
        ).toBe(false);
    });

    it('rejects extra keys on the payload (strict)', () => {
        expect(
            BufferedTacticsActionSchema.safeParse({
                type: TACTICS_MOVE_UNIT_ACTION,
                payload: { unitId: 'u1', x: 1, y: 0, extra: true },
            }).success,
        ).toBe(false);
    });

    it('rejects extra keys on the action wrapper (strict)', () => {
        expect(BufferedTacticsActionSchema.safeParse({ ...move, sneaky: 1 }).success).toBe(false);
    });
});

describe('LocalActionBufferSchema', () => {
    it('accepts an empty buffer and a mixed buffer', () => {
        expect(LocalActionBufferSchema.safeParse([]).success).toBe(true);
        expect(LocalActionBufferSchema.safeParse([move, attack, revealTile]).success).toBe(true);
    });

    it('accepts a buffer exactly at the cap and rejects one over it', () => {
        const atCap = Array.from({ length: MAX_COMMITTED_BUFFER_ACTIONS }, () => move);
        const overCap = Array.from({ length: MAX_COMMITTED_BUFFER_ACTIONS + 1 }, () => move);
        expect(LocalActionBufferSchema.safeParse(atCap).success).toBe(true);
        expect(LocalActionBufferSchema.safeParse(overCap).success).toBe(false);
    });

    it('rejects a non-array', () => {
        expect(LocalActionBufferSchema.safeParse({ 0: move }).success).toBe(false);
    });
});

describe('TacticsCommitmentEnvelopeValueSchema', () => {
    const value = { playerId: 'player-1', turnNumber: 4, actions: [move] };

    it('accepts a well-formed committed value', () => {
        expect(TacticsCommitmentEnvelopeValueSchema.safeParse(value).success).toBe(true);
    });

    it('rejects a negative turnNumber', () => {
        expect(
            TacticsCommitmentEnvelopeValueSchema.safeParse({ ...value, turnNumber: -1 }).success,
        ).toBe(false);
    });

    it('rejects a non-integer turnNumber', () => {
        expect(
            TacticsCommitmentEnvelopeValueSchema.safeParse({ ...value, turnNumber: 1.5 }).success,
        ).toBe(false);
    });

    it('rejects an empty playerId', () => {
        expect(
            TacticsCommitmentEnvelopeValueSchema.safeParse({ ...value, playerId: '' }).success,
        ).toBe(false);
    });

    it('rejects extra keys (strict)', () => {
        expect(
            TacticsCommitmentEnvelopeValueSchema.safeParse({ ...value, extra: true }).success,
        ).toBe(false);
    });

    it('rejects a value whose buffer contains an invalid action', () => {
        expect(
            TacticsCommitmentEnvelopeValueSchema.safeParse({
                ...value,
                actions: [{ type: 'tactics:bogus', payload: {} }],
            }).success,
        ).toBe(false);
    });
});
