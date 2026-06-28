/**
 * electron/main/SaveManager.test.ts
 *
 * Unit tests for SaveManager (§4.11, invariant #37).
 *
 * All I/O is handled by InMemorySaveRepository. File-system operations for
 * crash recovery (markCleanExit / clearCleanExitFlag / checkCrashRecovery)
 * use a real temp directory so the atomic-write contract is observable.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    InMemorySaveRepository,
    SaveNotFoundError,
} from '@chimera-engine/simulation/persistence/index.js';
import { makeFile } from '@chimera-engine/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import { createNoopLogger } from '../logging/logger.js';
import { SaveManager } from './SaveManager.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'chimera-savemanager-test-'));
}

function makeManager(dataDir: string): SaveManager {
    return new SaveManager(new InMemorySaveRepository(), dataDir, createNoopLogger());
}

// ── Construction ─────────────────────────────────────────────────────────────

describe('SaveManager — construction', () => {
    it('constructs with an InMemorySaveRepository', async () => {
        const tmpDir = await makeTmpDir();
        expect(() => makeManager(tmpDir)).not.toThrow();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});

// ── Delegation to repository ──────────────────────────────────────────────────

describe('SaveManager — repository delegation', () => {
    let tmpDir: string;
    let manager: SaveManager;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
        manager = makeManager(tmpDir);
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('list returns [] for an unknown game', async () => {
        expect(await manager.list('unknown')).toStrictEqual([]);
    });

    it('save then list returns one meta entry', async () => {
        await manager.save(makeFile('tactics', 'slot-1'));
        const slots = await manager.list('tactics');
        expect(slots).toHaveLength(1);
        expect(slots[0]?.slotId).toBe('tactics/slot-1');
    });

    it('load returns the saved file', async () => {
        const file = makeFile('tactics', 'slot-1');
        await manager.save(file);
        const loaded = await manager.load('tactics/slot-1');
        expect(loaded).toStrictEqual(file);
    });

    it('load throws SaveNotFoundError when absent', async () => {
        await expect(manager.load('tactics/absent')).rejects.toBeInstanceOf(SaveNotFoundError);
    });

    it('delete removes the slot', async () => {
        await manager.save(makeFile('tactics', 'slot-1'));
        await manager.delete('tactics/slot-1');
        expect(await manager.has('tactics/slot-1')).toBe(false);
    });

    it('has returns false before save and true after', async () => {
        expect(await manager.has('tactics/slot-1')).toBe(false);
        await manager.save(makeFile('tactics', 'slot-1'));
        expect(await manager.has('tactics/slot-1')).toBe(true);
    });
});

// ── autoSave ─────────────────────────────────────────────────────────────────

describe('SaveManager — autoSave', () => {
    let tmpDir: string;
    let manager: SaveManager;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
        manager = makeManager(tmpDir);
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('writes the file to <gameId>/autosave regardless of input slotId', async () => {
        const file = makeFile('tactics', 'slot-1');

        await manager.autoSave(file);

        expect(await manager.has('tactics/autosave')).toBe(true);
    });

    it('does not store the original slot when a different slotId was provided', async () => {
        const file = makeFile('tactics', 'slot-1');

        await manager.autoSave(file);

        expect(await manager.has('tactics/slot-1')).toBe(false);
    });

    it('overwrites a previous autosave', async () => {
        const file1 = makeFile('tactics', 'autosave', 1_000);
        const file2 = makeFile('tactics', 'autosave', 2_000);

        await manager.autoSave(file1);
        await manager.autoSave(file2);

        const loaded = await manager.load('tactics/autosave');
        expect(loaded.header.savedAt).toBe(2_000);
    });
});

// ── restoreFromSave ───────────────────────────────────────────────────────────

describe('SaveManager — restoreFromSave', () => {
    let tmpDir: string;
    let manager: SaveManager;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
        manager = makeManager(tmpDir);
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('returns the full SaveFile for a known slot', async () => {
        const file = makeFile('tactics', 'slot-1');
        await manager.save(file);

        const restored = await manager.restoreFromSave('tactics/slot-1');
        expect(restored).toStrictEqual(file);
    });

    it('throws SaveNotFoundError for an unknown slot', async () => {
        await expect(manager.restoreFromSave('tactics/missing')).rejects.toBeInstanceOf(
            SaveNotFoundError,
        );
    });
});

// ── Crash recovery ────────────────────────────────────────────────────────────

describe('SaveManager — crash recovery', () => {
    let tmpDir: string;
    let manager: SaveManager;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
        manager = makeManager(tmpDir);
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('checkCrashRecovery returns null when clean-exit flag is present', async () => {
        await manager.markCleanExit();

        const result = await manager.checkCrashRecovery([]);
        expect(result).toBeNull();
    });

    it('checkCrashRecovery returns null when flag is absent but no autosave exists', async () => {
        // Flag absent (never written) + no autosave for any game.
        const result = await manager.checkCrashRecovery(['tactics']);
        expect(result).toBeNull();
    });

    it('checkCrashRecovery returns autosave meta when flag is absent and autosave exists', async () => {
        await manager.save(makeFile('tactics', 'autosave'));

        const result = await manager.checkCrashRecovery(['tactics']);
        expect(result).not.toBeNull();
        expect(result?.slotId).toBe('tactics/autosave');
    });

    it('checkCrashRecovery returns null after markCleanExit even with an autosave', async () => {
        await manager.save(makeFile('tactics', 'autosave'));
        await manager.markCleanExit();

        const result = await manager.checkCrashRecovery(['tactics']);
        expect(result).toBeNull();
    });

    it('clearCleanExitFlag removes the flag file', async () => {
        await manager.markCleanExit();
        await manager.clearCleanExitFlag();

        // With flag cleared and autosave present, checkCrashRecovery should fire again.
        await manager.save(makeFile('tactics', 'autosave'));
        const result = await manager.checkCrashRecovery(['tactics']);
        expect(result).not.toBeNull();
    });

    it('clearCleanExitFlag returns false when the flag does not exist', async () => {
        await expect(manager.clearCleanExitFlag()).resolves.toBe(false);
    });

    it('clearCleanExitFlag returns true when the flag was present', async () => {
        await manager.markCleanExit();
        await expect(manager.clearCleanExitFlag()).resolves.toBe(true);
    });
});
