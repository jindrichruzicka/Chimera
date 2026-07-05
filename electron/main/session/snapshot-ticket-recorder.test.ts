/**
 * electron/main/session/snapshot-ticket-recorder.test.ts
 *
 * Unit tests for createSnapshotTicketRecorder (F68 #822): records a session
 * ticket from the first matchId-carrying client snapshot, dedupes repeats,
 * re-records on match/seat change, and never lets a store failure escape
 * into the live snapshot egress path.
 */

import { describe, expect, it, vi } from 'vitest';
import { InMemorySessionTicketStore } from './InMemorySessionTicketStore.js';
import { createSnapshotTicketRecorder } from './snapshot-ticket-recorder.js';
import type { SessionTicketStore } from './SessionTicketStore.js';

async function flushMicrotasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createSnapshotTicketRecorder', () => {
    it('records a ticket from the first matchId-carrying snapshot', async () => {
        const store = new InMemorySessionTicketStore();
        const record = createSnapshotTicketRecorder({
            store,
            gameId: 'tactics',
            now: () => 1_234,
        });

        record({ matchId: 'match-a', viewerId: 'p-alice' });
        await flushMicrotasks();

        expect(await store.claims()).toStrictEqual([
            { matchId: 'match-a', playerId: 'p-alice', gameId: 'tactics', updatedAt: 1_234 },
        ]);
    });

    it('ignores snapshots without a matchId', async () => {
        const store = new InMemorySessionTicketStore();
        const record = createSnapshotTicketRecorder({ store, gameId: 'tactics' });

        record({ viewerId: 'p-alice' });
        await flushMicrotasks();

        expect(await store.claims()).toStrictEqual([]);
    });

    it('dedupes repeat snapshots for the same match and seat', async () => {
        const store = new InMemorySessionTicketStore();
        const recordSpy = vi.spyOn(store, 'record');
        const record = createSnapshotTicketRecorder({ store, gameId: 'tactics' });

        record({ matchId: 'match-a', viewerId: 'p-alice' });
        record({ matchId: 'match-a', viewerId: 'p-alice' });
        record({ matchId: 'match-a', viewerId: 'p-alice' });
        await flushMicrotasks();

        expect(recordSpy).toHaveBeenCalledTimes(1);
    });

    it('re-records when the matchId changes', async () => {
        const store = new InMemorySessionTicketStore();
        const record = createSnapshotTicketRecorder({ store, gameId: 'tactics' });

        record({ matchId: 'match-a', viewerId: 'p-alice' });
        record({ matchId: 'match-b', viewerId: 'p-alice' });
        await flushMicrotasks();

        expect((await store.claims()).map((t) => t.matchId)).toStrictEqual(['match-b', 'match-a']);
    });

    it('re-records when the viewer seat changes within the same match', async () => {
        const store = new InMemorySessionTicketStore();
        const recordSpy = vi.spyOn(store, 'record');
        const record = createSnapshotTicketRecorder({ store, gameId: 'tactics' });

        record({ matchId: 'match-a', viewerId: 'p-alice' });
        record({ matchId: 'match-a', viewerId: 'p-bob' });
        await flushMicrotasks();

        expect(recordSpy).toHaveBeenCalledTimes(2);
        expect((await store.claims())[0]?.playerId).toBe('p-bob');
    });

    it('swallows and logs a store failure instead of throwing', async () => {
        const failingStore: SessionTicketStore = {
            record: () => Promise.reject(new Error('disk full')),
            claims: () => Promise.resolve([]),
        };
        const warn = vi.fn();
        const logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn,
            error: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn(),
        };
        const record = createSnapshotTicketRecorder({
            store: failingStore,
            gameId: 'tactics',
            logger,
        });

        expect(() => {
            record({ matchId: 'match-a', viewerId: 'p-alice' });
        }).not.toThrow();
        await flushMicrotasks();

        expect(warn).toHaveBeenCalledTimes(1);
    });
});
