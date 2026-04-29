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
import {
    JsonSaveSerializer,
    createDefaultMigrator,
} from '@chimera/simulation/persistence/index.js';
import { makeFile } from '@chimera/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import { FileSaveRepository } from './FileSaveRepository.js';
import { SaveManager } from './SaveManager.js';
import type { Logger } from '../logging/logger.js';

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
        new FileSaveRepository(new JsonSaveSerializer(), createDefaultMigrator(), savesDir),
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

// ── Crash recovery — end-to-end (§4.11, #376) ────────────────────────────────

describe('SaveManager + FileSaveRepository — crash recovery lifecycle', () => {
    let tmpDir: string;
    let savesDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chimera-crash-recovery-e2e-'));
        savesDir = path.join(tmpDir, 'saves');
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('detects a crash when no flag was written and an autosave exists', async () => {
        // Session 1: write an autosave but do NOT call markCleanExit (simulates crash).
        const session1 = makeManager(savesDir, tmpDir);
        await session1.save(makeFile('tactics', 'autosave'));

        // Session 2: fresh SaveManager — no clean-exit flag on disk.
        const session2 = makeManager(savesDir, tmpDir);
        const result = await session2.checkCrashRecovery(['tactics']);

        expect(result).not.toBeNull();
        expect(result?.slotId).toBe('tactics/autosave');
    });

    it('returns null when previous session called markCleanExit', async () => {
        // Session 1: write autosave AND call markCleanExit (graceful shutdown).
        const session1 = makeManager(savesDir, tmpDir);
        await session1.save(makeFile('tactics', 'autosave'));
        await session1.markCleanExit();

        // Session 2: flag is present → no crash recovery needed.
        const session2 = makeManager(savesDir, tmpDir);
        const result = await session2.checkCrashRecovery(['tactics']);

        expect(result).toBeNull();
    });

    it('returns null on first launch when no flag and no autosave exist', async () => {
        // No saves written, no flag present → clean first launch scenario.
        const manager = makeManager(savesDir, tmpDir);
        const result = await manager.checkCrashRecovery(['tactics']);

        expect(result).toBeNull();
    });

    it('clearCleanExitFlag removes the flag so next launch detects the crash', async () => {
        // Session 1: clean exit.
        const session1 = makeManager(savesDir, tmpDir);
        await session1.save(makeFile('tactics', 'autosave'));
        await session1.markCleanExit();

        // Session 2 startup: clear flag (returns true), then crash recovery finds nothing.
        const session2 = makeManager(savesDir, tmpDir);
        const wasClean = await session2.clearCleanExitFlag();
        expect(wasClean).toBe(true);

        // Session 2 crashes (no markCleanExit). Session 3 detects the crash.
        const session3 = makeManager(savesDir, tmpDir);
        const result = await session3.checkCrashRecovery(['tactics']);
        expect(result).not.toBeNull();
        expect(result?.slotId).toBe('tactics/autosave');
    });
});
