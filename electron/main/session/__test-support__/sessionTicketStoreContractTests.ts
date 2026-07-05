/**
 * electron/main/session/__test-support__/sessionTicketStoreContractTests.ts
 *
 * Shared SessionTicketStore contract test suite — reusable across every
 * SessionTicketStore implementation (§4.11/§4.14, invariants #37/#41).
 *
 * Usage:
 *   import { runSessionTicketStoreContractTests } from './__test-support__/sessionTicketStoreContractTests.js';
 *   runSessionTicketStoreContractTests('MyStore', () => new MyStore());
 *
 * Tests cover the full SessionTicketStore contract:
 *   - claims: empty for a fresh store; most-recently-recorded first
 *   - record: round-trip; upsert by matchId (single entry, moved to front)
 *   - LRU eviction at SESSION_TICKET_CAP (least-recently-recorded evicted)
 *   - immutability: inputs never mutated; returned lists are snapshots
 */

import { describe, expect, it } from 'vitest';
import type { SessionTicket, SessionTicketStore } from '../SessionTicketStore.js';
import {
    InvalidSessionTicketError,
    SESSION_TICKET_CAP,
    SESSION_TICKET_MAX_CLAIM_ID_LENGTH,
} from '../SessionTicketStore.js';

// ── Shared test factory ──────────────────────────────────────────────────────

/** Build a minimal valid SessionTicket for test purposes. */
export function makeTicket(
    matchId: string,
    overrides: Partial<Omit<SessionTicket, 'matchId'>> = {},
): SessionTicket {
    return {
        matchId,
        playerId: overrides.playerId ?? 'player-1',
        gameId: overrides.gameId ?? 'test-game',
        updatedAt: overrides.updatedAt ?? 1_700_000_000_000,
    };
}

/**
 * Run the full SessionTicketStore contract test suite against the provided
 * factory function. Call this in any test file that wants to validate a
 * SessionTicketStore implementation (invariant #41 — file and in-memory
 * twins must be behaviourally identical).
 */
export function runSessionTicketStoreContractTests(
    name: string,
    factory: () => SessionTicketStore,
): void {
    describe(`${name} — SessionTicketStore contract`, () => {
        // ── claims ───────────────────────────────────────────────────────────

        it('claims returns an empty array for a fresh store', async () => {
            const store = factory();

            expect(await store.claims()).toStrictEqual([]);
        });

        it('record then claims round-trips the ticket', async () => {
            const store = factory();
            const ticket = makeTicket('match-a', { playerId: 'p-alice', gameId: 'tactics' });

            await store.record(ticket);

            expect(await store.claims()).toStrictEqual([ticket]);
        });

        it('claims returns tickets most-recently-recorded first', async () => {
            const store = factory();
            await store.record(makeTicket('match-a', { updatedAt: 1_000 }));
            await store.record(makeTicket('match-b', { updatedAt: 2_000 }));
            await store.record(makeTicket('match-c', { updatedAt: 3_000 }));

            const claims = await store.claims();

            expect(claims.map((t) => t.matchId)).toStrictEqual(['match-c', 'match-b', 'match-a']);
        });

        // ── record: upsert by matchId ────────────────────────────────────────

        it('record overwrites an existing matchId instead of duplicating it', async () => {
            const store = factory();
            await store.record(makeTicket('match-a', { playerId: 'p-old', updatedAt: 1_000 }));

            const updated = makeTicket('match-a', { playerId: 'p-new', updatedAt: 2_000 });
            await store.record(updated);

            expect(await store.claims()).toStrictEqual([updated]);
        });

        it('re-recording an existing matchId moves it to the front', async () => {
            const store = factory();
            await store.record(makeTicket('match-a'));
            await store.record(makeTicket('match-b'));

            await store.record(makeTicket('match-a', { updatedAt: 9_000 }));

            const claims = await store.claims();
            expect(claims.map((t) => t.matchId)).toStrictEqual(['match-a', 'match-b']);
        });

        // ── LRU eviction ─────────────────────────────────────────────────────

        it(`evicts the least-recently-recorded ticket beyond SESSION_TICKET_CAP (${SESSION_TICKET_CAP})`, async () => {
            const store = factory();
            for (let i = 0; i < SESSION_TICKET_CAP + 1; i += 1) {
                await store.record(makeTicket(`match-${i}`, { updatedAt: i }));
            }

            const claims = await store.claims();

            expect(claims).toHaveLength(SESSION_TICKET_CAP);
            // match-0 (the oldest) is gone; the newest is first.
            expect(claims.some((t) => t.matchId === 'match-0')).toBe(false);
            expect(claims[0]?.matchId).toBe(`match-${SESSION_TICKET_CAP}`);
        });

        it('upserting an existing matchId at cap does not evict anything', async () => {
            const store = factory();
            for (let i = 0; i < SESSION_TICKET_CAP; i += 1) {
                await store.record(makeTicket(`match-${i}`));
            }

            await store.record(makeTicket('match-1', { updatedAt: 9_000 }));

            const claims = await store.claims();
            expect(claims).toHaveLength(SESSION_TICKET_CAP);
            expect(claims.some((t) => t.matchId === 'match-0')).toBe(true);
        });

        // ── record: invalid-ticket rejection ─────────────────────────────────
        //
        // Snapshot-sourced ids are unbounded on the wire (PlayerSnapshot.matchId
        // is a plain optional string), so the store is the boundary that keeps
        // unpresentable tickets out: ids longer than the JOIN claim wire bound
        // would be dropped by sanitizeSeatClaims at join time — and an
        // all-dropped list goes out as `claims: []`, opting the client out of
        // the claimless slot fallback (#821).

        const INVALID_TICKETS: readonly {
            readonly label: string;
            readonly ticket: SessionTicket;
        }[] = [
            { label: 'empty matchId', ticket: makeTicket('') },
            {
                label: 'matchId over the wire claim bound',
                ticket: makeTicket('m'.repeat(SESSION_TICKET_MAX_CLAIM_ID_LENGTH + 1)),
            },
            { label: 'empty playerId', ticket: makeTicket('match-a', { playerId: '' }) },
            {
                label: 'playerId over the wire claim bound',
                ticket: makeTicket('match-a', {
                    playerId: 'p'.repeat(SESSION_TICKET_MAX_CLAIM_ID_LENGTH + 1),
                }),
            },
            { label: 'empty gameId', ticket: makeTicket('match-a', { gameId: '' }) },
            {
                label: 'non-finite updatedAt',
                ticket: makeTicket('match-a', { updatedAt: Number.NaN }),
            },
        ];

        for (const { label, ticket } of INVALID_TICKETS) {
            it(`record rejects a ticket with ${label} and stores nothing`, async () => {
                const store = factory();

                let pending: Promise<void>;
                // Must reject, never throw synchronously — the production
                // caller is fire-and-forget (`void record().catch(...)`).
                expect(() => {
                    pending = store.record(ticket);
                }).not.toThrow();
                await expect(pending!).rejects.toThrow(InvalidSessionTicketError);

                expect(await store.claims()).toStrictEqual([]);
            });
        }

        it('a rejected record leaves previously stored tickets intact', async () => {
            const store = factory();
            const valid = makeTicket('match-a');
            await store.record(valid);

            await expect(store.record(makeTicket(''))).rejects.toThrow(InvalidSessionTicketError);

            expect(await store.claims()).toStrictEqual([valid]);
        });

        // ── immutability ─────────────────────────────────────────────────────

        it('record does not mutate the input ticket', async () => {
            const store = factory();
            const ticket = makeTicket('match-a');
            const before = { ...ticket };

            await store.record(ticket);

            expect(ticket).toStrictEqual(before);
        });

        it('a returned claims list is a snapshot — later records do not alter it', async () => {
            const store = factory();
            await store.record(makeTicket('match-a'));

            const first = await store.claims();
            await store.record(makeTicket('match-b'));

            expect(first.map((t) => t.matchId)).toStrictEqual(['match-a']);
        });
    });
}
