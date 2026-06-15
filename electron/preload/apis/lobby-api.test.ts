import { describe, expect, it, vi } from 'vitest';
import {
    LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL,
    LOBBY_GET_CURRENT_STATE_CHANNEL,
    LOBBY_HOST_CHANNEL,
    LOBBY_JOIN_CHANNEL,
    LOBBY_LEAVE_CHANNEL,
    LOBBY_START_GAME_CHANNEL,
    LOBBY_UPDATE_READY_STATE_CHANNEL,
    LOBBY_SET_MATCH_SETTING_CHANNEL,
    LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL,
    LOBBY_ADD_AI_CHANNEL,
    LOBBY_REMOVE_AI_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
    LOBBY_PLAYER_CONNECTION_CHANNEL,
    LOBBY_PROFILE_REJECTED_CHANNEL,
    createLobbyApi,
    type LobbyApiIpcPort,
    type LobbyApiListener,
} from './lobby-api.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';
import { playerId } from '../api-types.js';
import type {
    HostLobbyParams,
    JoinLobbyParams,
    LobbyInfo,
    LobbyState,
    PlayerConnectionEvent,
    ProfileRejection,
} from '../api-types.js';

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

    describe('startGame()', () => {
        it('invokes chimera:lobby:start-game and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);

            const result = await api.startGame();

            expect(stub.invocations).toEqual([
                { channel: LOBBY_START_GAME_CHANNEL, arg: undefined },
            ]);
            expect(result).toBeUndefined();
        });

        it('rejects when the main-process handler rejects', async () => {
            const stub = makeIpcStub();
            const port: LobbyApiIpcPort = {
                ...stub.port,
                invoke: (channel) => {
                    if (channel === LOBBY_START_GAME_CHANNEL) {
                        return Promise.reject(new Error('start failed'));
                    }
                    return stub.port.invoke(channel);
                },
            };
            const api = createLobbyApi(port);

            await expect(api.startGame()).rejects.toThrow('start failed');
        });
    });

    describe('getLocalPlayerId()', () => {
        it('invokes chimera:lobby:get-local-player-id and resolves to a player id string', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL, 'player-2');
            const api = createLobbyApi(stub.port);

            const result = await api.getLocalPlayerId();

            expect(stub.invocations).toEqual([
                { channel: LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL, arg: undefined },
            ]);
            expect(result).toBe('player-2');
        });

        it('resolves to null when no local player identity is available', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL, null);
            const api = createLobbyApi(stub.port);

            await expect(api.getLocalPlayerId()).resolves.toBeNull();
        });
    });

    describe('getCurrentState()', () => {
        it('invokes chimera:lobby:get-current-state and resolves to the active LobbyState', async () => {
            const stub = makeIpcStub();
            const state = makeLobbyState();
            stub.invokeResults.set(LOBBY_GET_CURRENT_STATE_CHANNEL, state);
            const api = createLobbyApi(stub.port);

            const result = await api.getCurrentState();

            expect(stub.invocations).toEqual([
                { channel: LOBBY_GET_CURRENT_STATE_CHANNEL, arg: undefined },
            ]);
            expect(result).toStrictEqual(state);
        });

        it('resolves to null when no lobby session is active', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(LOBBY_GET_CURRENT_STATE_CHANNEL, null);
            const api = createLobbyApi(stub.port);

            await expect(api.getCurrentState()).resolves.toBeNull();
        });

        it('rejects with PreloadIpcValidationError when main returns malformed current state', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(LOBBY_GET_CURRENT_STATE_CHANNEL, { info: { sessionId: 7 } });
            const api = createLobbyApi(stub.port);

            await expect(api.getCurrentState()).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('updatePlayerReadyState()', () => {
        it('invokes chimera:lobby:update-ready-state with a boolean and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);

            const result = await api.updatePlayerReadyState(true);

            expect(stub.invocations).toEqual([
                { channel: LOBBY_UPDATE_READY_STATE_CHANNEL, arg: true },
            ]);
            expect(result).toBeUndefined();
        });

        it('rejects when the main-process handler rejects', async () => {
            const stub = makeIpcStub();
            const port: LobbyApiIpcPort = {
                ...stub.port,
                invoke: (channel) => {
                    if (channel === LOBBY_UPDATE_READY_STATE_CHANNEL) {
                        return Promise.reject(new Error('ready update failed'));
                    }
                    return stub.port.invoke(channel);
                },
            };
            const api = createLobbyApi(port);

            await expect(api.updatePlayerReadyState(false)).rejects.toThrow('ready update failed');
        });
    });

    describe('setMatchSetting()', () => {
        it('invokes chimera:lobby:set-match-setting with {key, value} and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);

            const result = await api.setMatchSetting('boardColor', 'crimson');

            expect(stub.invocations).toEqual([
                {
                    channel: LOBBY_SET_MATCH_SETTING_CHANNEL,
                    arg: { key: 'boardColor', value: 'crimson' },
                },
            ]);
            expect(result).toBeUndefined();
        });

        it('rejects when the main-process handler rejects (e.g. non-host write)', async () => {
            const stub = makeIpcStub();
            const port: LobbyApiIpcPort = {
                ...stub.port,
                invoke: (channel) => {
                    if (channel === LOBBY_SET_MATCH_SETTING_CHANNEL) {
                        return Promise.reject(new Error('only hosted sessions'));
                    }
                    return stub.port.invoke(channel);
                },
            };
            const api = createLobbyApi(port);

            await expect(api.setMatchSetting('boardColor', 'crimson')).rejects.toThrow(
                'only hosted sessions',
            );
        });
    });

    describe('setPlayerAttribute()', () => {
        it('invokes chimera:lobby:set-player-attribute with {playerId, key, value} and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);

            const result = await api.setPlayerAttribute(playerId('p2'), 'unitColor', 'blue');

            expect(stub.invocations).toEqual([
                {
                    channel: LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL,
                    arg: { playerId: 'p2', key: 'unitColor', value: 'blue' },
                },
            ]);
            expect(result).toBeUndefined();
        });

        it('rejects when the main-process handler rejects (e.g. non-host write)', async () => {
            const stub = makeIpcStub();
            const port: LobbyApiIpcPort = {
                ...stub.port,
                invoke: (channel) => {
                    if (channel === LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL) {
                        return Promise.reject(new Error('only hosted sessions'));
                    }
                    return stub.port.invoke(channel);
                },
            };
            const api = createLobbyApi(port);

            await expect(
                api.setPlayerAttribute(playerId('p2'), 'unitColor', 'blue'),
            ).rejects.toThrow('only hosted sessions');
        });
    });

    describe('addAi()', () => {
        it('invokes chimera:lobby:add-ai with no payload and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);

            const result = await api.addAi();

            expect(stub.invocations).toEqual([{ channel: LOBBY_ADD_AI_CHANNEL, arg: undefined }]);
            expect(result).toBeUndefined();
        });

        it('rejects when the main-process handler rejects (e.g. non-host or full lobby)', async () => {
            const stub = makeIpcStub();
            const port: LobbyApiIpcPort = {
                ...stub.port,
                invoke: (channel) => {
                    if (channel === LOBBY_ADD_AI_CHANNEL) {
                        return Promise.reject(new Error('only hosted sessions'));
                    }
                    return stub.port.invoke(channel);
                },
            };
            const api = createLobbyApi(port);

            await expect(api.addAi()).rejects.toThrow('only hosted sessions');
        });
    });

    describe('removeAi()', () => {
        it('invokes chimera:lobby:remove-ai with {slotIndex} and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);

            const result = await api.removeAi(2);

            expect(stub.invocations).toEqual([
                { channel: LOBBY_REMOVE_AI_CHANNEL, arg: { slotIndex: 2 } },
            ]);
            expect(result).toBeUndefined();
        });

        it('rejects when the main-process handler rejects (e.g. non-host write)', async () => {
            const stub = makeIpcStub();
            const port: LobbyApiIpcPort = {
                ...stub.port,
                invoke: (channel) => {
                    if (channel === LOBBY_REMOVE_AI_CHANNEL) {
                        return Promise.reject(new Error('only hosted sessions'));
                    }
                    return stub.port.invoke(channel);
                },
            };
            const api = createLobbyApi(port);

            await expect(api.removeAi(2)).rejects.toThrow('only hosted sessions');
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

    describe('onPlayerConnectionChanged()', () => {
        it('registers a listener on chimera:lobby:player-connection and forwards only the event payload', () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);
            const callback = vi.fn<(event: PlayerConnectionEvent) => void>();

            api.onPlayerConnectionChanged(callback);

            const registered = stub.listeners.get(LOBBY_PLAYER_CONNECTION_CHANNEL);
            expect(registered?.size).toBe(1);

            const event: PlayerConnectionEvent = {
                playerId: playerId('p2'),
                status: 'disconnected',
            };
            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, event);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(event);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);
            const callback = vi.fn<(event: PlayerConnectionEvent) => void>();

            const unsubscribe = api.onPlayerConnectionChanged(callback);
            expect(stub.listeners.get(LOBBY_PLAYER_CONNECTION_CHANNEL)?.size).toBe(1);
            unsubscribe();
            expect(stub.listeners.get(LOBBY_PLAYER_CONNECTION_CHANNEL)?.size).toBe(0);
        });
    });

    describe('onProfileRejected()', () => {
        it('registers a listener on chimera:lobby:profile-rejected and forwards only the rejection payload', () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);
            const callback = vi.fn<(rejection: ProfileRejection) => void>();

            api.onProfileRejected(callback);

            const registered = stub.listeners.get(LOBBY_PROFILE_REJECTED_CHANNEL);
            expect(registered?.size).toBe(1);

            const rejection: ProfileRejection = { reason: 'profile:AVATAR_TOO_LARGE' };
            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, rejection);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(rejection);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createLobbyApi(stub.port);
            const callback = vi.fn<(rejection: ProfileRejection) => void>();

            const unsubscribe = api.onProfileRejected(callback);
            expect(stub.listeners.get(LOBBY_PROFILE_REJECTED_CHANNEL)?.size).toBe(1);
            unsubscribe();
            expect(stub.listeners.get(LOBBY_PROFILE_REJECTED_CHANNEL)?.size).toBe(0);
        });
    });
});
