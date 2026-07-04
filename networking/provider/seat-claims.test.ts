/**
 * networking/provider/seat-claims.test.ts
 *
 * Unit tests for the client-side seat-claim sanitizer (F68/#821). The host
 * silently drops schema-invalid JOIN frames, so a caller passing out-of-bounds
 * claims would hang the join; the sanitizer degrades such input to a frame the
 * wire schema accepts instead.
 *
 * Architecture: §4.14 — Multiplayer Provider & WebSocket
 * Task: F68 / #821
 */

import { describe, it, expect } from 'vitest';
import {
    WIRE_MAX_JOIN_CLAIMS,
    WIRE_MAX_JOIN_CLAIM_ID_LENGTH,
} from '@chimera-engine/simulation/foundation/messages-schemas.js';
import type { SeatClaim } from './MultiplayerProvider.js';
import { sanitizeSeatClaims } from './seat-claims.js';

const valid = (n: number): SeatClaim => ({ matchId: 'match-1', playerId: `seat-${n}` });

describe('sanitizeSeatClaims (F68/#821)', () => {
    it('returns undefined for undefined (no claims presented)', () => {
        expect(sanitizeSeatClaims(undefined)).toBeUndefined();
    });

    it('passes through in-bounds claims unchanged, preserving order', () => {
        const claims = [valid(1), valid(2), valid(3)];
        expect(sanitizeSeatClaims(claims)).toEqual(claims);
    });

    it('accepts ids exactly at the wire length cap', () => {
        const claim: SeatClaim = {
            matchId: 'm'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH),
            playerId: 'p'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH),
        };
        expect(sanitizeSeatClaims([claim])).toEqual([claim]);
    });

    it('drops entries with overlong ids', () => {
        const overlong: SeatClaim = {
            matchId: 'm'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH + 1),
            playerId: 'seat-a',
        };
        expect(sanitizeSeatClaims([overlong, valid(1)])).toEqual([valid(1)]);
    });

    it('drops entries with empty ids', () => {
        expect(
            sanitizeSeatClaims([
                { matchId: '', playerId: 'seat-a' },
                { matchId: 'match-1', playerId: '' },
                valid(1),
            ]),
        ).toEqual([valid(1)]);
    });

    it('drops entries with non-string ids (unvalidated caller data)', () => {
        const bogus = [
            { matchId: 42, playerId: 'seat-a' },
            { matchId: 'match-1', playerId: null },
            valid(1),
        ] as readonly SeatClaim[];
        expect(sanitizeSeatClaims(bogus)).toEqual([valid(1)]);
    });

    it('strips extra properties down to exactly {matchId, playerId}', () => {
        // Callers build claims by spreading save-manifest seats, which carry
        // slotIndex/control; a leaked extra key would fail the host's strict
        // wire schema and hang the join instead of degrading to a fresh id.
        const withExtras = {
            matchId: 'match-1',
            playerId: 'seat-a',
            slotIndex: 0,
            control: 'remote',
        } as unknown as SeatClaim;
        const result = sanitizeSeatClaims([withExtras]);
        expect(result).toEqual([{ matchId: 'match-1', playerId: 'seat-a' }]);
        expect(Object.keys(result![0]!)).toEqual(['matchId', 'playerId']);
    });

    it('caps the result at the wire entry cap, keeping the earliest entries', () => {
        const claims = Array.from({ length: WIRE_MAX_JOIN_CLAIMS + 5 }, (_, i) => valid(i));
        expect(sanitizeSeatClaims(claims)).toEqual(claims.slice(0, WIRE_MAX_JOIN_CLAIMS));
    });

    it('returns [] (not undefined) when every entry is dropped — claims stay "presented"', () => {
        const overlong: SeatClaim = {
            matchId: 'm'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH + 1),
            playerId: 'seat-a',
        };
        expect(sanitizeSeatClaims([overlong])).toEqual([]);
        expect(sanitizeSeatClaims([])).toEqual([]);
    });
});
