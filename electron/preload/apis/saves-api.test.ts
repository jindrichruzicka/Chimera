import { describe, expect, it, vi } from 'vitest';
import {
    SAVES_CANCEL_RESTORE_CHANNEL,
    SAVES_DELETE_CHANNEL,
    SAVES_LIST_CHANNEL,
    SAVES_LOAD_CHANNEL,
    SAVES_RESTORE_STATUS_CHANNEL,
    SAVES_SAVE_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
    createSavesApi,
    type SavesApiIpcPort,
    type SavesApiListener,
} from './saves-api.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';
import { playerId, toSlotId } from '../api-types.js';
import type { RestoreStatusEvent, SaveRequest, SaveSlotMeta } from '../api-types.js';

/**
 * Recording stub for the narrow `SavesApiIpcPort` slice. Captures every call
 * so tests can assert the exact channel / payload protocol without pulling
 * in a real Electron `ipcRenderer`.
 */
function makeIpcStub(): {
    readonly port: SavesApiIpcPort;
    readonly invocations: { channel: string; arg: unknown }[];
    readonly listeners: Map<string, Set<SavesApiListener>>;
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: { channel: string; arg: unknown }[] = [];
    const listeners = new Map<string, Set<SavesApiListener>>();
    const invokeResults = new Map<string, unknown>();

    const port: SavesApiIpcPort = {
        invoke: (channel, arg) => {
            invocations.push({ channel, arg });
            return Promise.resolve(invokeResults.get(channel));
        },
        on: (channel, listener) => {
            const set = listeners.get(channel) ?? new Set<SavesApiListener>();
            set.add(listener);
            listeners.set(channel, set);
        },
        removeListener: (channel, listener) => {
            listeners.get(channel)?.delete(listener);
        },
    };

    return { port, invocations, listeners, invokeResults };
}

function makeSlot(id: string): SaveSlotMeta {
    return { slotId: toSlotId(id), gameId: 'sample-game', tick: 42, savedAt: 1_700_000_000 };
}

describe('createSavesApi', () => {
    describe('list()', () => {
        it('invokes chimera:saves:list with the gameId and resolves to SaveSlotMeta[]', async () => {
            const stub = makeIpcStub();
            const expected = [makeSlot('slot-a'), makeSlot('slot-b')];
            stub.invokeResults.set(SAVES_LIST_CHANNEL, expected);
            const api = createSavesApi(stub.port);

            const result = await api.list('sample-game');

            expect(stub.invocations).toEqual([{ channel: SAVES_LIST_CHANNEL, arg: 'sample-game' }]);
            expect(result).toStrictEqual(expected);
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed payload', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(SAVES_LIST_CHANNEL, 'not-an-array');
            const api = createSavesApi(stub.port);

            await expect(api.list('sample-game')).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('save()', () => {
        it('invokes chimera:saves:save with the SaveRequest and resolves to SaveSlotMeta', async () => {
            const stub = makeIpcStub();
            const expected = makeSlot('slot-a');
            stub.invokeResults.set(SAVES_SAVE_CHANNEL, expected);
            const api = createSavesApi(stub.port);
            const request: SaveRequest = { gameId: 'sample-game', label: 'autosave' };

            const result = await api.save(request);

            expect(stub.invocations).toEqual([{ channel: SAVES_SAVE_CHANNEL, arg: request }]);
            expect(result).toStrictEqual(expected);
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed payload', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(SAVES_SAVE_CHANNEL, { slotId: 'slot-a', gameId: 'sample-game' });
            const api = createSavesApi(stub.port);

            await expect(
                api.save({ gameId: 'sample-game', label: 'autosave' }),
            ).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('load()', () => {
        it('invokes chimera:saves:load with the slotId and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createSavesApi(stub.port);

            await expect(api.load(toSlotId('slot-a'))).resolves.toBeUndefined();
            expect(stub.invocations).toEqual([{ channel: SAVES_LOAD_CHANNEL, arg: 'slot-a' }]);
        });
    });

    describe('delete()', () => {
        it('invokes chimera:saves:delete with the slotId and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createSavesApi(stub.port);

            await expect(api.delete(toSlotId('slot-a'))).resolves.toBeUndefined();
            expect(stub.invocations).toEqual([{ channel: SAVES_DELETE_CHANNEL, arg: 'slot-a' }]);
        });
    });

    describe('cancelRestore()', () => {
        it('invokes chimera:saves:cancel-restore with no payload and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createSavesApi(stub.port);

            await expect(api.cancelRestore()).resolves.toBeUndefined();
            expect(stub.invocations).toEqual([
                { channel: SAVES_CANCEL_RESTORE_CHANNEL, arg: undefined },
            ]);
        });
    });

    describe('onRestoreStatus()', () => {
        const waitingEvent: RestoreStatusEvent = {
            state: 'waiting',
            gameId: 'sample-game',
            matchId: 'match-1',
            lobbyCode: '127.0.0.1:7777:token',
            pendingSeats: [playerId('remote-a')],
        };

        it('registers a listener on chimera:saves:restore-status and forwards a valid event', () => {
            const stub = makeIpcStub();
            const api = createSavesApi(stub.port);
            const callback = vi.fn<(event: RestoreStatusEvent) => void>();

            api.onRestoreStatus(callback);

            const registered = stub.listeners.get(SAVES_RESTORE_STATUS_CHANNEL);
            expect(registered?.size).toBe(1);

            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, waitingEvent);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(waitingEvent);
        });

        it('drops a malformed push without throwing — fail closed, logged, callback unaware', () => {
            const stub = makeIpcStub();
            const api = createSavesApi(stub.port);
            const callback = vi.fn<(event: RestoreStatusEvent) => void>();
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            try {
                api.onRestoreStatus(callback);
                const listener = [...(stub.listeners.get(SAVES_RESTORE_STATUS_CHANNEL) ?? [])][0];

                expect(() =>
                    listener?.({}, { state: 'exploded', gameId: '', pendingSeats: null }),
                ).not.toThrow();

                expect(callback).not.toHaveBeenCalled();
                expect(consoleError).toHaveBeenCalledOnce();
                expect(String(consoleError.mock.calls[0]?.[0])).toContain(
                    SAVES_RESTORE_STATUS_CHANNEL,
                );

                // A valid event afterwards still reaches the callback.
                listener?.({}, waitingEvent);
                expect(callback).toHaveBeenCalledOnce();
                expect(callback).toHaveBeenCalledWith(waitingEvent);
            } finally {
                consoleError.mockRestore();
            }
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createSavesApi(stub.port);
            const cbA = vi.fn<(event: RestoreStatusEvent) => void>();
            const cbB = vi.fn<(event: RestoreStatusEvent) => void>();

            const unsubA = api.onRestoreStatus(cbA);
            api.onRestoreStatus(cbB);
            expect(stub.listeners.get(SAVES_RESTORE_STATUS_CHANNEL)?.size).toBe(2);

            unsubA();
            expect(stub.listeners.get(SAVES_RESTORE_STATUS_CHANNEL)?.size).toBe(1);

            for (const listener of stub.listeners.get(SAVES_RESTORE_STATUS_CHANNEL) ?? []) {
                listener({}, waitingEvent);
            }
            expect(cbA).not.toHaveBeenCalled();
            expect(cbB).toHaveBeenCalledOnce();
        });
    });

    describe('onSlotUpdate()', () => {
        it('registers a listener on chimera:saves:slot-update and forwards only the slots payload', () => {
            const stub = makeIpcStub();
            const api = createSavesApi(stub.port);
            const callback = vi.fn<(slots: readonly SaveSlotMeta[]) => void>();

            api.onSlotUpdate(callback);

            const registered = stub.listeners.get(SAVES_SLOT_UPDATE_CHANNEL);
            expect(registered?.size).toBe(1);

            const slots = [makeSlot('slot-a')];
            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, slots);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(slots);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createSavesApi(stub.port);
            const callback = vi.fn<(slots: readonly SaveSlotMeta[]) => void>();

            const unsubscribe = api.onSlotUpdate(callback);
            const beforeUnsub = stub.listeners.get(SAVES_SLOT_UPDATE_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(SAVES_SLOT_UPDATE_CHANNEL)?.size).toBe(0);
        });

        it('supports multiple independent subscriptions', () => {
            const stub = makeIpcStub();
            const api = createSavesApi(stub.port);
            const cbA = vi.fn<(slots: readonly SaveSlotMeta[]) => void>();
            const cbB = vi.fn<(slots: readonly SaveSlotMeta[]) => void>();

            const unsubA = api.onSlotUpdate(cbA);
            api.onSlotUpdate(cbB);

            const slots = [makeSlot('slot-a')];
            for (const listener of stub.listeners.get(SAVES_SLOT_UPDATE_CHANNEL) ?? []) {
                listener({}, slots);
            }
            expect(cbA).toHaveBeenCalledOnce();
            expect(cbA).toHaveBeenCalledWith(slots);
            expect(cbB).toHaveBeenCalledOnce();

            cbA.mockClear();
            cbB.mockClear();
            unsubA();
            for (const listener of stub.listeners.get(SAVES_SLOT_UPDATE_CHANNEL) ?? []) {
                listener({}, slots);
            }
            expect(cbA).not.toHaveBeenCalled();
            expect(cbB).toHaveBeenCalledOnce();
        });
    });
});
