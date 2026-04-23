/**
 * electron/main/SaveManager.e2e.test.ts
 *
 * End-to-end integration test: verifies that saves written by one SaveManager
 * instance backed by FileSaveRepository are readable by a fresh SaveManager
 * pointed at the same directory (BLOCK-1 fix validation).
 *
 * Unlike the unit tests in SaveManager.test.ts, this test uses a real
 * temporary directory to exercise the full persistence round-trip.
 *
 * Task: F09 / #191
 */

import * as os from 'node:os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonSaveSerializer, SaveMigrator } from '@chimera/simulation/persistence/index.js';
import { makeFile } from '@chimera/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import { FileSaveRepository } from './saves/FileSaveRepository.js';
import { SaveManager } from './SaveManager.js';
import type { Logger } from './logger.js';

// ── Stub logger ────────────────────────────────────────────────────────────────

const noop = (): void => undefined;
const stubLogger: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => stubLogger,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeManager(savesDir: string, dataDir: string): SaveManager {
    return new SaveManager(
        new FileSaveRepository(new JsonSaveSerializer(), new SaveMigrator(), savesDir),
        dataDir,
        stubLogger,
    );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SaveManager + FileSaveRepository — persistence round-trip (BLOCK-1)', () => {
    let tmpDir: string;
    let savesDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chimera-save-e2e-'));
        savesDir = path.join(tmpDir, 'saves');
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('a save written in one SaveManager lifetime is listed by a fresh SaveManager', async () => {
        const file = makeFile('tactics', 'slot-1');
        const manager1 = makeManager(savesDir, tmpDir);
        await manager1.save(file);

        // Simulate process restart — construct a brand-new SaveManager against
        // the same directory. No shared state; purely filesystem-backed.
        const manager2 = makeManager(savesDir, tmpDir);
        const slots = await manager2.list('tactics');

        expect(slots).toHaveLength(1);
        expect(slots[0]?.slotId).toBe('tactics/slot-1');
    });

    it('list returns [] for an unknown gameId after a restart', async () => {
        const file = makeFile('tactics', 'autosave');
        const manager1 = makeManager(savesDir, tmpDir);
        await manager1.save(file);

        const manager2 = makeManager(savesDir, tmpDir);

        expect(await manager2.list('other-game')).toStrictEqual([]);
    });

    it('the loaded file matches the saved file across two SaveManager lifetimes', async () => {
        const file = makeFile('tactics', 'autosave');
        const manager1 = makeManager(savesDir, tmpDir);
        await manager1.save(file);

        const manager2 = makeManager(savesDir, tmpDir);
        const loaded = await manager2.load('tactics/autosave');

        expect(loaded.header.gameId).toBe('tactics');
        expect(loaded.header.slotId).toBe('autosave');
        expect(loaded.header.turnNumber).toBe(file.header.turnNumber);
    });
});
