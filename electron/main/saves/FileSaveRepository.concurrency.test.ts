/**
 * electron/main/saves/FileSaveRepository.concurrency.test.ts
 *
 * Verifies that FileSaveRepository.list() caps concurrent FS calls to
 * LIST_CONCURRENCY (issue #139 — WARN-9).
 *
 * `vi.mock` is automatically hoisted above all imports by vitest so the
 * factory runs before FileSaveRepository imports 'fs/promises'.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── fs/promises mock ──────────────────────────────────────────────────────────
// Hoisted: replaces 'fs/promises' for this file AND all modules it imports,
// including FileSaveRepository.ts.

let currentConcurrency = 0;
let peakConcurrency = 0;

function resetCounters(): void {
    currentConcurrency = 0;
    peakConcurrency = 0;
}

// Minimal valid JSON that JsonSaveSerializer.deserialize can parse.
const FAKE_SAVE_JSON = JSON.stringify({
    header: {
        schemaVersion: 2,
        engineVersion: '0.1.0',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        slotId: 'slot-000',
        savedAt: 1_700_000_000_000,
        turnNumber: 1,
        playerNames: ['Alice', 'Bob'],
    },
    checkpoint: {
        tick: 1,
        seed: 42,
        players: {},
        entities: {},
        phase: 'playing',
        events: [],
        turnNumber: 0,
    },
    deltaActions: [],
    pendingCommitments: {},
    stagedReveals: {},
});

vi.mock('fs/promises', () => {
    return {
        readdir: vi.fn(),
        readFile: vi.fn(async () => {
            currentConcurrency++;
            if (currentConcurrency > peakConcurrency) {
                peakConcurrency = currentConcurrency;
            }
            // Yield so all 200 concurrent starts register before any resolve.
            await Promise.resolve();
            currentConcurrency--;
            return Buffer.from(FAKE_SAVE_JSON);
        }),
        stat: vi.fn(() => Promise.resolve({ size: 512 })),
        // Other fs methods FileSaveRepository uses internally (not in list()):
        mkdir: vi.fn(() => Promise.resolve(undefined)),
        open: vi.fn(),
        rename: vi.fn(),
        unlink: vi.fn(),
        access: vi.fn(),
        rm: vi.fn(),
        writeFile: vi.fn(),
    };
});

import * as fsMocked from 'fs/promises';
import { FileSaveRepository, LIST_CONCURRENCY } from './FileSaveRepository.js';
import {
    JsonSaveSerializer,
    createDefaultMigrator,
} from '@chimera-engine/simulation/persistence/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRepo(): FileSaveRepository {
    return new FileSaveRepository(new JsonSaveSerializer(), createDefaultMigrator(), '/fake/base');
}

function makeEntries(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `slot-${String(i).padStart(3, '0')}.chimera`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FileSaveRepository — list() concurrency cap (issue #139)', () => {
    beforeEach(() => {
        resetCounters();
        vi.mocked(fsMocked.readdir).mockResolvedValue(makeEntries(200) as never);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('exports LIST_CONCURRENCY constant equal to 16', () => {
        expect(LIST_CONCURRENCY).toBe(16);
    });

    it('list() returns all 200 results when given 200 save files', async () => {
        const repo = makeRepo();

        const results = await repo.list('tactics');

        expect(results).toHaveLength(200);
    });

    it('list() processes at most LIST_CONCURRENCY readFile calls simultaneously', async () => {
        const repo = makeRepo();

        await repo.list('tactics');

        // Before the fix (unbounded Promise.all) the peak would be 200.
        // After the fix it must be ≤ LIST_CONCURRENCY (16).
        expect(peakConcurrency).toBeLessThanOrEqual(LIST_CONCURRENCY);
    });
});
