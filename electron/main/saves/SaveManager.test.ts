/**
 * electron/main/SaveManager.test.ts
 *
 * Unit tests for SaveManager (§4.11, invariant #37).
 *
 * All I/O is handled by InMemorySaveRepository — SaveManager itself is a thin
 * delegation layer with no filesystem access of its own.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
    InMemorySaveRepository,
    SaveNotFoundError,
} from '@chimera-engine/simulation/persistence/index.js';
import { makeFile } from '@chimera-engine/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import { createNoopLogger } from '../logging/logger.js';
import { SaveManager } from './SaveManager.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeManager(): SaveManager {
    return new SaveManager(new InMemorySaveRepository(), createNoopLogger());
}

// ── Construction ─────────────────────────────────────────────────────────────

describe('SaveManager — construction', () => {
    it('constructs with an InMemorySaveRepository', () => {
        expect(() => makeManager()).not.toThrow();
    });
});

// ── Delegation to repository ──────────────────────────────────────────────────

describe('SaveManager — repository delegation', () => {
    let manager: SaveManager;

    beforeEach(() => {
        manager = makeManager();
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
    let manager: SaveManager;

    beforeEach(() => {
        manager = makeManager();
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
    let manager: SaveManager;

    beforeEach(() => {
        manager = makeManager();
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
