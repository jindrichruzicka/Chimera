/**
 * simulation/persistence/SaveChecksum.test.ts
 *
 * Tests for computeBodyChecksum (issue #134).
 *
 * TDD cycle: tests written first — RED before SaveChecksum.ts exists.
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no Node.js FS or Electron imports.
 */

import { describe, expect, it } from 'vitest';
import { computeBodyChecksum } from './SaveChecksum.js';
import type { SaveBody } from './SaveChecksum.js';
import type { GamePhase } from '../engine/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBody(): SaveBody {
    return {
        checkpoint: {
            tick: 1,
            seed: 42,
            players: {},
            entities: {},
            phase: 'playing' as GamePhase,
            events: [],
            turnNumber: 0,
            timers: {},
            gameResult: null,
        },
        deltaActions: [],
        pendingCommitments: {},
        stagedReveals: {},
    };
}

// ─── computeBodyChecksum ──────────────────────────────────────────────────────

describe('computeBodyChecksum', () => {
    it('returns a non-empty hex string', async () => {
        const checksum = await computeBodyChecksum(makeBody());

        expect(typeof checksum).toBe('string');
        expect(checksum.length).toBeGreaterThan(0);
        expect(/^[0-9a-f]+$/.test(checksum)).toBe(true);
    });

    it('returns a 64-character string (SHA-256 hex)', async () => {
        const checksum = await computeBodyChecksum(makeBody());

        expect(checksum).toHaveLength(64);
    });

    it('is deterministic: same body always produces the same checksum', async () => {
        const body = makeBody();
        const first = await computeBodyChecksum(body);
        const second = await computeBodyChecksum(body);

        expect(first).toBe(second);
    });

    it('produces different checksums for different bodies', async () => {
        const body1 = makeBody();
        const body2: SaveBody = {
            ...makeBody(),
            checkpoint: { ...makeBody().checkpoint, tick: 999 },
        };

        const checksum1 = await computeBodyChecksum(body1);
        const checksum2 = await computeBodyChecksum(body2);

        expect(checksum1).not.toBe(checksum2);
    });

    it('only hashes checkpoint, deltaActions, pendingCommitments — not the header', async () => {
        const body = makeBody();
        // Adding extra properties to the body object should not affect the checksum
        // if they are not part of the canonical fields.
        const checksum1 = await computeBodyChecksum(body);

        // Same checkpoint/deltaActions/pendingCommitments values → same checksum
        const bodyWithExtra = {
            checkpoint: body.checkpoint,
            deltaActions: body.deltaActions,
            pendingCommitments: body.pendingCommitments,
            stagedReveals: body.stagedReveals,
        };
        const checksum2 = await computeBodyChecksum(bodyWithExtra);

        expect(checksum1).toBe(checksum2);
    });

    it('integrity-protects a populated stagedReveals map', async () => {
        const empty = await computeBodyChecksum(makeBody());
        const withStaged = await computeBodyChecksum({
            ...makeBody(),
            stagedReveals: {
                'env-1': { envelopeId: 'env-1', playerId: 'p1', nonce: 'n', value: { a: 1 } },
            } as SaveBody['stagedReveals'],
        });

        expect(withStaged).not.toBe(empty);
    });

    it('treats an empty stagedReveals as absent (backward-compatible with pre-#26 checksums)', async () => {
        // A v4 file's stored checksum was computed without the field; after the
        // v4→v5 migration backfills `{}`, recomputing must still match.
        const withEmpty = await computeBodyChecksum({ ...makeBody(), stagedReveals: {} });
        const withoutField = await computeBodyChecksum({
            checkpoint: makeBody().checkpoint,
            deltaActions: makeBody().deltaActions,
            pendingCommitments: makeBody().pendingCommitments,
        } as SaveBody);

        expect(withEmpty).toBe(withoutField);
    });

    it('excludes the session manifest entirely, like the header (#820)', async () => {
        // A v5 file's stored checksum was computed without `session`; after the
        // v5→v6 migration backfills a manifest, recomputing must still match —
        // even for a POPULATED manifest (unlike stagedReveals, `session` is
        // host-local orchestration metadata and is never integrity-protected).
        const without = await computeBodyChecksum(makeBody());
        const withSession = await computeBodyChecksum({
            ...makeBody(),
            session: {
                matchId: 'match-uuid-1',
                maxPlayers: 2,
                seats: [{ playerId: 'p1', control: 'host', slotIndex: 0 }],
            },
        } as SaveBody);

        expect(withSession).toBe(without);
    });
});
