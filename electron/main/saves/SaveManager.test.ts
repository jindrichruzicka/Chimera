/**
 * electron/main/SaveManager.test.ts
 *
 * Unit tests for SaveManager (§4.11, invariant #37).
 *
 * All I/O is handled by InMemorySaveRepository — SaveManager itself is a thin
 * delegation layer with no filesystem access of its own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    InMemorySaveRepository,
    SaveNotFoundError,
} from '@chimera-engine/simulation/persistence/index.js';
import { makeFile } from '@chimera-engine/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import {
    AUTOSAVE_SLOT_NAME,
    autosaveSlotId,
} from '@chimera-engine/simulation/foundation/save-slots.js';
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

// ── onSlotsChanged ────────────────────────────────────────────────────────────

/**
 * A manager wired to a listener spy, plus the repository behind it so a case
 * can ask what was already written at the moment the listener ran.
 */
function makeListeningManager(): {
    manager: SaveManager;
    repository: InMemorySaveRepository;
    onSlotsChanged: ReturnType<typeof vi.fn<(gameId: string) => void>>;
} {
    const repository = new InMemorySaveRepository();
    const onSlotsChanged = vi.fn<(gameId: string) => void>();
    return {
        manager: new SaveManager(repository, createNoopLogger(), onSlotsChanged),
        repository,
        onSlotsChanged,
    };
}

describe('SaveManager — onSlotsChanged', () => {
    it('fires after autoSave with the gameId whose slot list changed', async () => {
        const { manager, onSlotsChanged } = makeListeningManager();

        await manager.autoSave(makeFile('tactics', 'slot-1'));

        expect(onSlotsChanged).toHaveBeenCalledExactlyOnceWith('tactics');
    });

    it('fires after save with the gameId whose slot list changed', async () => {
        const { manager, onSlotsChanged } = makeListeningManager();

        await manager.save(makeFile('tactics', 'slot-1'));

        expect(onSlotsChanged).toHaveBeenCalledExactlyOnceWith('tactics');
    });

    it('fires once per autoSave — three autosaves notify three times', async () => {
        // The frequency contract: one notification per write, no coalescing and
        // no debounce. Autosave fires after every accepted `engine:end_turn`,
        // so a batch of turns is a batch of notifications, each carrying the
        // same gameId. Should a debounce ever be wanted, it belongs in the
        // composition root's listener, not here — this seam stays 1:1 so the
        // count above is a fact about writes.
        const { manager, onSlotsChanged } = makeListeningManager();

        await manager.autoSave(makeFile('tactics', 'slot-1', 1_000));
        await manager.autoSave(makeFile('tactics', 'slot-1', 2_000));
        await manager.autoSave(makeFile('tactics', 'slot-1', 3_000));

        expect(onSlotsChanged.mock.calls).toEqual([['tactics'], ['tactics'], ['tactics']]);
    });

    it('fires only after the autosave is readable from the repository', async () => {
        // Asks the repository the question the listener's consumer will ask —
        // "what is in this game's slot list now?" — at the moment the listener
        // runs. A notification fired before the awaited write resolves reads
        // back `false` here, so moving the call above the `await` fails.
        const repository = new InMemorySaveRepository();
        const visibleAtNotify: Promise<boolean>[] = [];
        const manager = new SaveManager(repository, createNoopLogger(), (gameId) => {
            visibleAtNotify.push(repository.has(autosaveSlotId(gameId)));
        });

        await manager.autoSave(makeFile('tactics', 'slot-1'));

        expect(await Promise.all(visibleAtNotify)).toEqual([true]);
    });

    it('fires only after a manual save is readable from the repository', async () => {
        const repository = new InMemorySaveRepository();
        const visibleAtNotify: Promise<boolean>[] = [];
        const manager = new SaveManager(repository, createNoopLogger(), () => {
            visibleAtNotify.push(repository.has('tactics/slot-1'));
        });

        await manager.save(makeFile('tactics', 'slot-1'));

        expect(await Promise.all(visibleAtNotify)).toEqual([true]);
    });

    it('does not fire when the autosave write rejects', async () => {
        const { manager, repository, onSlotsChanged } = makeListeningManager();
        vi.spyOn(repository, 'save').mockRejectedValue(new Error('disk full'));

        await expect(manager.autoSave(makeFile('tactics', 'slot-1'))).rejects.toThrow('disk full');

        expect(onSlotsChanged).not.toHaveBeenCalled();
    });

    it('does not fire when the manual save write rejects', async () => {
        const { manager, repository, onSlotsChanged } = makeListeningManager();
        vi.spyOn(repository, 'save').mockRejectedValue(new Error('disk full'));

        await expect(manager.save(makeFile('tactics', 'slot-1'))).rejects.toThrow('disk full');

        expect(onSlotsChanged).not.toHaveBeenCalled();
    });

    it('does not fire for reads — list, load and has change no slot list', async () => {
        const { manager, onSlotsChanged } = makeListeningManager();
        await manager.save(makeFile('tactics', 'slot-1'));
        onSlotsChanged.mockClear();

        await manager.list('tactics');
        await manager.load('tactics/slot-1');
        await manager.has('tactics/slot-1');
        await manager.restoreFromSave('tactics/slot-1');

        expect(onSlotsChanged).not.toHaveBeenCalled();
    });

    it('does not fire on delete — that push stays with the saves IPC handler', async () => {
        // `delete` takes a qualified slotId and no gameId, and its only caller
        // is the `chimera:saves:delete` round-trip, which already lists and
        // broadcasts for the renderer that asked. This seam exists for the
        // writes NO round-trip observes: the autosave after an accepted
        // end-turn, and the crash reporter's capture.
        const { manager, onSlotsChanged } = makeListeningManager();
        await manager.save(makeFile('tactics', 'slot-1'));
        onSlotsChanged.mockClear();

        await manager.delete('tactics/slot-1');

        expect(onSlotsChanged).not.toHaveBeenCalled();
    });

    it('persists the autosave and resolves even when the listener throws', async () => {
        // The listener is a push into renderer windows; a failure there must
        // never turn a persisted save into a rejected one for the caller.
        const repository = new InMemorySaveRepository();
        const manager = new SaveManager(repository, createNoopLogger(), () => {
            throw new Error('no window to send to');
        });

        await expect(manager.autoSave(makeFile('tactics', 'slot-1'))).resolves.toBeUndefined();
        expect(await repository.has(autosaveSlotId('tactics'))).toBe(true);
    });

    it('persists a manual save and resolves even when the listener throws', async () => {
        const repository = new InMemorySaveRepository();
        const manager = new SaveManager(repository, createNoopLogger(), () => {
            throw new Error('no window to send to');
        });

        await expect(manager.save(makeFile('tactics', 'slot-1'))).resolves.toBeUndefined();
        expect(await repository.has('tactics/slot-1')).toBe(true);
    });

    it('writes without a listener — the callback is optional', async () => {
        const manager = makeManager();

        await expect(manager.autoSave(makeFile('tactics', 'slot-1'))).resolves.toBeUndefined();
        await expect(manager.save(makeFile('tactics', 'slot-2'))).resolves.toBeUndefined();
        expect(await manager.has(autosaveSlotId('tactics'))).toBe(true);
    });
});

// ── Autosave slot contract ────────────────────────────────────────────────────

describe('SaveManager — autosave slot contract', () => {
    it('stamps the header with the contract bare slot name', async () => {
        const repository = new InMemorySaveRepository();
        const manager = new SaveManager(repository, createNoopLogger());

        await manager.autoSave(makeFile('tactics', 'slot-1'));

        const written = await repository.load(autosaveSlotId('tactics'));
        expect(written.header.slotId).toBe(AUTOSAVE_SLOT_NAME);
    });

    it('writes to the qualified id autosaveSlotId builds', async () => {
        // The link the renderer's `selectHasAutosave` depends on: the id the
        // helper produces is the id `SaveRepository.list` will report.
        const manager = makeManager();

        await manager.autoSave(makeFile('tactics', 'slot-1'));

        const slots = await manager.list('tactics');
        expect(slots.map((slot) => slot.slotId)).toEqual([autosaveSlotId('tactics')]);
    });
});
