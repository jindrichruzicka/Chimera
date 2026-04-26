import { describe, expect, it, vi } from 'vitest';
import {
    LOBBY_HOST_CHANNEL,
    LOBBY_JOIN_CHANNEL,
    LOBBY_LEAVE_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
    createLobbyApi,
    type LobbyApiIpcPort,
    type LobbyApiListener,
} from './lobby-api.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';
import type { HostLobbyParams, JoinLobbyParams, LobbyInfo, LobbyState } from '../api-types.js';

/**
 * Recording stub for the narrow `LobbyApiIpcPort` slice. Captures every call
 * so tests can assert the exact channel / payload protocol without pulling
 * in a real Electron `ipcRenderer`.
 */
function makeIpcStub(): {
    readonly port: LobbyApiIpcPort;
    readonly invocations: { channel: string; arg: unknown }[];
    readonly listeners: Map<string, Set<LobbyApiListener>>;
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: { channel: string; arg: unknown }[] = [];
    const listeners = new Map<string, Set<LobbyApiListener>>();
    const invokeResults = new Map<string, unknown>();

    const port: LobbyApiIpcPort = {
        invoke: (channel, arg) => {
            invocations.push({ channel, arg });
            return Promise.resolve(invokeResults.get(channel));
        },
        on: (channel, listener) => {
            const set = listeners.get(channel) ?? new Set<LobbyApiListener>();
            set.add(listener);
            listeners.set(channel, set);
        },
        removeListener: (channel, listener) => {
            listeners.get(channel)?.delete(listener);
        },
    };

    return { port, invocations, listeners, invokeResults };
}

function makeLobbyInfo(): LobbyInfo {
    return {
        sessionId: 'sess-1',
        hostId: 'p1',
        gameId: 'sample-game',
    };
}

function makeLobbyState(): LobbyState {
    return {
        info: makeLobbyInfo(),
        players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
    };
}

describe('createLobbyApi', () => {
    describe('host()', () => {
        it('invokes chimera:lobby:host with the params and resolves to LobbyInfo', async () => {
            const stub = makeIpcStub();
            const expected = makeLobbyInfo();
            stub.invokeResults.set(LOBBY_HOST_CHANNEL, expected);
            const api = createLobbyApi(stub.port);
            const params: HostLobbyParams = { gameId: 'sample-game', maxPlayers: 4 };

            const result = await api.host(params);

            expect(stub.invocations).toEqual([{ channel: LOBBY_HOST_CHANNEL, arg: params }]);
            expect(result).toStrictEqual(expected);
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed payload', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(LOBBY_HOST_CHANNEL, { sessionId: 'sess-1', hostId: 'p1' });
            const api = createLobbyApi(stub.port);

            await expect(api.host({ gameId: 'sample-game', maxPlayers: 4 })).rejects.toBeInstanceOf(
                PreloadIpcValidationError,
            );
        });
    });

    describe('join()', () => {
        it('invokes chimera:lobby:join with the params and resolves to LobbyInfo', async () => {
            const stub = makeIpcStub();
            const expected = makeLobbyInfo();
            stub.invokeResults.set(LOBBY_JOIN_CHANNEL, expected);
            const api = createLobbyApi(stub.port);
            const params: JoinLobbyParams = { address: 'ws://127.0.0.1:7777' };

            const result = await api.join(params);

            expect(stub.invocations).toEqual([{ channel: LOBBY_JOIN_CHANNEL, arg: params }]);
            expect(result).toStrictEqual(expected);
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed payload', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(LOBBY_JOIN_CHANNEL, { sessionId: 42 });
            const api = createLobbyApi(stub.port);

            await expect(api.join({ address: 'ws://127.0.0.1:7777' })).rejects.toBeInstanceOf(
                PreloadIpcValidationError,
            );
        });
    });

    describe('leave()', () => {
        it('invokes chimera:lobby:leave and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);

            const result = await api.leave();

            expect(stub.invocations).toEqual([{ channel: LOBBY_LEAVE_CHANNEL, arg: undefined }]);
            expect(result).toBeUndefined();
        });

        it('rejects when the main-process handler rejects', async () => {
            const stub = makeIpcStub();
            const port: LobbyApiIpcPort = {
                ...stub.port,
                invoke: (channel) => {
                    if (channel === LOBBY_LEAVE_CHANNEL) {
                        return Promise.reject(new Error('closeLobby failed'));
                    }
                    return stub.port.invoke(channel);
                },
            };
            const api = createLobbyApi(port);

            await expect(api.leave()).rejects.toThrow('closeLobby failed');
        });
    });

    describe('onUpdate()', () => {
        it('registers a listener on chimera:lobby:update and forwards only the LobbyState payload', () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);
            const callback = vi.fn<(lobby: LobbyState) => void>();

            api.onUpdate(callback);

            const registered = stub.listeners.get(LOBBY_UPDATE_CHANNEL);
            expect(registered?.size).toBe(1);

            // Main emits via `webContents.send(channel, state)`; the preload
            // listener receives `(event, state)`. Verify the event is
            // stripped before the callback runs.
            const state = makeLobbyState();
            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, state);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(state);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);
            const callback = vi.fn<(lobby: LobbyState) => void>();

            const unsubscribe = api.onUpdate(callback);
            const beforeUnsub = stub.listeners.get(LOBBY_UPDATE_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(LOBBY_UPDATE_CHANNEL)?.size).toBe(0);
        });

        it('supports multiple independent subscriptions', () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);
            const cbA = vi.fn<(lobby: LobbyState) => void>();
            const cbB = vi.fn<(lobby: LobbyState) => void>();

            const unsubA = api.onUpdate(cbA);
            api.onUpdate(cbB);

            const state = makeLobbyState();
            for (const listener of stub.listeners.get(LOBBY_UPDATE_CHANNEL) ?? []) {
                listener({}, state);
            }
            expect(cbA).toHaveBeenCalledOnce();
            expect(cbA).toHaveBeenCalledWith(state);
            expect(cbB).toHaveBeenCalledOnce();
            expect(cbB).toHaveBeenCalledWith(state);

            cbA.mockClear();
            cbB.mockClear();
            unsubA();
            for (const listener of stub.listeners.get(LOBBY_UPDATE_CHANNEL) ?? []) {
                listener({}, state);
            }
            expect(cbA).not.toHaveBeenCalled();
            expect(cbB).toHaveBeenCalledOnce();
        });
    });
});
