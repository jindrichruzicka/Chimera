/**
 * electron/main/session/FileSessionTicketStore.test.ts
 *
 * Integration tests for FileSessionTicketStore (F68 #822, invariant #23).
 *
 * Uses a temporary directory with a unique suffix so tests never share state.
 * Runs the shared SessionTicketStore contract test suite to guarantee
 * interface parity with InMemorySessionTicketStore (invariant #41), plus
 * file-specific cases: corrupt-file recovery (degrade to empty, never crash),
 * persistence across instances, stale `.tmp` invisibility, and load clamping.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    makeTicket,
    runSessionTicketStoreContractTests,
} from './__test-support__/sessionTicketStoreContractTests.js';
import { SESSION_TICKET_CAP, SESSION_TICKET_MAX_CLAIM_ID_LENGTH } from './SessionTicketStore.js';
import { FileSessionTicketStore } from './FileSessionTicketStore.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'chimera-sessionticketstore-test-'));
}

function ticketsPath(baseDir: string): string {
    return path.join(baseDir, 'session-tickets.json');
}

function makeStore(baseDir: string): FileSessionTicketStore {
    return new FileSessionTicketStore(ticketsPath(baseDir));
}

// ── Shared contract tests ────────────────────────────────────────────────────

const contractDirs: string[] = [];

runSessionTicketStoreContractTests('FileSessionTicketStore', () => {
    const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'chimera-ticket-contract-'));
    contractDirs.push(tmpBase);
    return makeStore(tmpBase);
});

afterAll(() => {
    for (const dir of contractDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ── FileSessionTicketStore-specific integration tests ────────────────────────

describe('FileSessionTicketStore — integration', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('claims returns [] when the tickets file does not exist', async () => {
        const store = makeStore(tmpDir);

        expect(await store.claims()).toStrictEqual([]);
    });

    it('record persists across store instances on the same path', async () => {
        const ticket = makeTicket('match-a', { playerId: 'p-alice' });
        await makeStore(tmpDir).record(ticket);

        const reopened = makeStore(tmpDir);

        expect(await reopened.claims()).toStrictEqual([ticket]);
    });

    it('degrades to empty on a corrupt (non-JSON) file instead of crashing', async () => {
        await fs.writeFile(ticketsPath(tmpDir), 'not json {{{', 'utf8');
        const store = makeStore(tmpDir);

        expect(await store.claims()).toStrictEqual([]);
    });

    it('degrades to empty on a schema-invalid envelope instead of crashing', async () => {
        await fs.writeFile(
            ticketsPath(tmpDir),
            JSON.stringify({ version: 1, tickets: 'not-an-array' }),
            'utf8',
        );
        const store = makeStore(tmpDir);

        expect(await store.claims()).toStrictEqual([]);
    });

    it('skips invalid ticket entries individually — valid siblings survive', async () => {
        const good1 = makeTicket('match-a', { updatedAt: 1 });
        const good2 = makeTicket('match-b', { updatedAt: 2 });
        await fs.writeFile(
            ticketsPath(tmpDir),
            JSON.stringify({
                version: 1,
                tickets: [
                    good1,
                    { matchId: 42 },
                    makeTicket(''),
                    makeTicket('match-oversized', {
                        playerId: 'p'.repeat(SESSION_TICKET_MAX_CLAIM_ID_LENGTH + 1),
                    }),
                    good2,
                ],
            }),
            'utf8',
        );
        const store = makeStore(tmpDir);

        expect(await store.claims()).toStrictEqual([good2, good1]);
    });

    it('invalid entries do not crowd valid ones out of the load clamp', async () => {
        const invalid = Array.from({ length: SESSION_TICKET_CAP }, () => makeTicket(''));
        const good = makeTicket('match-survivor');
        await fs.writeFile(
            ticketsPath(tmpDir),
            JSON.stringify({ version: 1, tickets: [good, ...invalid] }),
            'utf8',
        );
        const store = makeStore(tmpDir);

        expect(await store.claims()).toStrictEqual([good]);
    });

    it('degrades to empty on an unknown envelope version instead of crashing', async () => {
        await fs.writeFile(
            ticketsPath(tmpDir),
            JSON.stringify({ version: 999, tickets: [] }),
            'utf8',
        );
        const store = makeStore(tmpDir);

        expect(await store.claims()).toStrictEqual([]);
    });

    it('record rewrites a corrupt file cleanly', async () => {
        await fs.writeFile(ticketsPath(tmpDir), 'not json {{{', 'utf8');
        const store = makeStore(tmpDir);
        const ticket = makeTicket('match-a');

        await store.record(ticket);

        expect(await store.claims()).toStrictEqual([ticket]);
        expect(await makeStore(tmpDir).claims()).toStrictEqual([ticket]);
    });

    it('record does not leave a .tmp file behind', async () => {
        const store = makeStore(tmpDir);

        await store.record(makeTicket('match-a'));

        const entries = await fs.readdir(tmpDir);
        expect(entries).toStrictEqual(['session-tickets.json']);
    });

    it('a stale .tmp file is never read', async () => {
        const store = makeStore(tmpDir);
        await store.record(makeTicket('match-a'));
        await fs.writeFile(`${ticketsPath(tmpDir)}.tmp`, 'garbage from a crash', 'utf8');

        expect((await store.claims()).map((t) => t.matchId)).toStrictEqual(['match-a']);
    });

    it('clamps an over-cap file to the newest SESSION_TICKET_CAP tickets on load', async () => {
        // Hand-write a file with 5 tickets beyond the cap; on-disk order is
        // oldest-first, so the newest are at the tail and must survive.
        const total = SESSION_TICKET_CAP + 5;
        const tickets = Array.from({ length: total }, (_, i) =>
            makeTicket(`match-${i}`, { updatedAt: i }),
        );
        await fs.writeFile(ticketsPath(tmpDir), JSON.stringify({ version: 1, tickets }), 'utf8');
        const store = makeStore(tmpDir);

        const claims = await store.claims();

        expect(claims).toHaveLength(SESSION_TICKET_CAP);
        expect(claims[0]?.matchId).toBe(`match-${total - 1}`);
        expect(claims.some((t) => t.matchId === 'match-0')).toBe(false);
    });

    it('concurrent fire-and-forget records do not lose tickets', async () => {
        const store = makeStore(tmpDir);

        await Promise.all([
            store.record(makeTicket('match-a')),
            store.record(makeTicket('match-b')),
            store.record(makeTicket('match-c')),
        ]);

        const claims = await store.claims();
        expect(claims.map((t) => t.matchId).sort()).toStrictEqual([
            'match-a',
            'match-b',
            'match-c',
        ]);
    });
});
