/**
 * electron/main/__tests__/saves-slot-update-push.integration.test.ts
 *
 * How many `chimera:saves:slot-update` pushes one save produces.
 *
 * Two seams can push, and each is unit-tested in isolation: `SaveManager`
 * notifies its listener (`SaveManager.test.ts`), and the saves IPC handler
 * broadcasts after a delete but not after a save (`ipc-handlers.test.ts`).
 * Neither can see the number that matters, which is what the two seams add up
 * to when a real manager sits behind a real handler.
 *
 * Everything below the IPC boundary is real: `registerSavesHandlers`,
 * `createSavesIpcPort`, `SaveManager`, `InMemorySaveRepository`. Only the
 * window fan-out is a double — the push itself is `webContents.send`, which
 * needs Electron.
 *
 * Architecture: §4.11 — Save / Load Persistence.
 */

import { describe, expect, it } from 'vitest';
import { InMemorySaveRepository } from '@chimera-engine/simulation/persistence/index.js';
import { makeFile } from '@chimera-engine/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import { autosaveSlotId } from '@chimera-engine/simulation/foundation/save-slots.js';
import type { SaveRequest, SaveSlotMeta } from '../../preload/api-types.js';
import {
    registerSavesHandlers,
    type SavesHandlersIpcMain,
    type SavesInvokeHandler,
} from '../ipc/ipc-handlers.js';
import { createSavesIpcPort } from '../saves/SavesIpcAdapter.js';
import { SaveManager } from '../saves/SaveManager.js';
import { createNoopLogger } from '../logging/logger.js';

const GAME_ID = 'tactics';

interface Wiring {
    readonly handlers: Map<string, SavesInvokeHandler>;
    readonly saveManager: SaveManager;
    /** One entry per push, in order. */
    readonly pushes: readonly SaveSlotMeta[][];
    /** Drain the fire-and-forget refresh the listener starts. */
    readonly settle: () => Promise<void>;
}

/**
 * Wire the saves namespace the way `electron/main/index.ts` does: the manager's
 * `onSlotsChanged` re-lists through the same port the handlers use and pushes,
 * and the handler's `broadcastSlotsChanged` pushes what it was handed.
 */
function wireSavesNamespace(): Wiring {
    const handlers = new Map<string, SavesInvokeHandler>();
    const ipcMain: SavesHandlersIpcMain = {
        handle: (channel, handler) => {
            handlers.set(channel, handler);
        },
    };
    const pushes: SaveSlotMeta[][] = [];
    const pending: Promise<unknown>[] = [];

    const repository = new InMemorySaveRepository();
    const saveManager = new SaveManager(repository, createNoopLogger(), (gameId) => {
        pending.push(
            savesPort.list(gameId).then((slots) => {
                pushes.push(slots);
            }),
        );
    });

    const savesPort = createSavesIpcPort({
        saveManager,
        captureSaveFile: (request: SaveRequest) =>
            Promise.resolve(makeFile(request.gameId, request.slotId ?? 'slot-1')),
        logger: createNoopLogger(),
    });

    registerSavesHandlers({
        ipcMain,
        saves: savesPort,
        broadcastSlotsChanged: (_gameId, slots) => {
            pushes.push(slots);
        },
        cancelRestore: () => Promise.resolve(),
    });

    return {
        handlers,
        saveManager,
        pushes,
        settle: async () => {
            await Promise.all(pending);
        },
    };
}

async function invoke(wiring: Wiring, channel: string, payload: unknown): Promise<unknown> {
    const handler = wiring.handlers.get(channel);
    expect(handler, `no handler registered for ${channel}`).toBeDefined();
    return handler?.({}, payload);
}

describe('chimera:saves:slot-update — pushes per operation', () => {
    it('pushes exactly once for a manual save over IPC', async () => {
        const wiring = wireSavesNamespace();

        await invoke(wiring, 'chimera:saves:save', { gameId: GAME_ID, slotId: 'slot-1' });
        await wiring.settle();

        expect(wiring.pushes).toHaveLength(1);
        expect(wiring.pushes[0]?.map((slot) => slot.slotId)).toEqual([`${GAME_ID}/slot-1`]);
    });

    it('pushes exactly once for an autosave, which reaches no IPC handler', async () => {
        const wiring = wireSavesNamespace();

        await wiring.saveManager.autoSave(makeFile(GAME_ID, 'slot-1'));
        await wiring.settle();

        expect(wiring.pushes).toHaveLength(1);
        expect(wiring.pushes[0]?.map((slot) => slot.slotId)).toEqual([autosaveSlotId(GAME_ID)]);
    });

    it('pushes exactly once for a delete over IPC', async () => {
        const wiring = wireSavesNamespace();
        await invoke(wiring, 'chimera:saves:save', { gameId: GAME_ID, slotId: 'slot-1' });
        await wiring.settle();

        await invoke(wiring, 'chimera:saves:delete', `${GAME_ID}/slot-1`);
        await wiring.settle();

        expect(wiring.pushes).toHaveLength(2);
        expect(wiring.pushes[1]).toEqual([]);
    });

    it('pushes once per save across a run of them — three saves, three pushes', async () => {
        // The frequency contract end to end: no coalescing anywhere between the
        // repository write and the window fan-out.
        const wiring = wireSavesNamespace();

        await wiring.saveManager.autoSave(makeFile(GAME_ID, 'slot-1'));
        await invoke(wiring, 'chimera:saves:save', { gameId: GAME_ID, slotId: 'slot-2' });
        await wiring.saveManager.autoSave(makeFile(GAME_ID, 'slot-1'));
        await wiring.settle();

        expect(wiring.pushes).toHaveLength(3);
    });

    it('pushes a list a reader can answer "has an autosave" from', async () => {
        // The end the renderer's `selectHasAutosave` reads: the qualified id it
        // matches on is the id this push carries.
        const wiring = wireSavesNamespace();

        await wiring.saveManager.autoSave(makeFile(GAME_ID, 'slot-1'));
        await wiring.settle();

        const pushed = wiring.pushes[0] ?? [];
        expect(pushed.some((slot) => slot.slotId === autosaveSlotId(GAME_ID))).toBe(true);
    });
});
