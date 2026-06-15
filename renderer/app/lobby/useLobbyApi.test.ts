// renderer/app/lobby/useLobbyApi.test.ts
// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLobbyBridge, useLobbyApi } from './useLobbyApi';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { playerId } from '@chimera/electron/preload/api-types.js';

describe('getLobbyBridge', () => {
    it('returns null when chimera bridge is unavailable', () => {
        const bridge = getLobbyBridge({});

        expect(bridge).toBeNull();
    });

    it('returns typed lobby and system APIs when present', () => {
        const lobby = {
            host: vi.fn(),
            join: vi.fn(),
            getLocalPlayerId: vi.fn(),
            leave: vi.fn(),
            startGame: vi.fn(),
            updatePlayerReadyState: vi.fn(),
            onUpdate: vi.fn(),
        };
        const system = {
            onConnectionStatus: vi.fn(),
        };

        const bridge = getLobbyBridge({
            __chimera: {
                lobby,
                system,
            },
        });

        expect(bridge).toEqual({
            lobby,
            system,
        });
    });
});

describe('useLobbyApi', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(globalThis, '__chimera');
        useLobbyUiStore.getState().clearLocalLobbyContext();
    });

    it('throws when calling host without preload bridge', async () => {
        const { result } = renderHook(() => useLobbyApi());

        await expect(
            result.current.host({
                gameId: 'tactics',
                maxPlayers: 4,
            }),
        ).rejects.toThrow('Chimera API not available');
    });

    it('delegates host, join and leave through the bridge lobby API', async () => {
        const host = vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' }));
        const join = vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' }));
        const getLocalPlayerId = vi.fn(async () => 'p2');
        const leave = vi.fn(async () => undefined);
        const startGame = vi.fn(async () => undefined);
        const updatePlayerReadyState = vi.fn(async () => undefined);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host,
                    join,
                    getLocalPlayerId,
                    leave,
                    startGame,
                    updatePlayerReadyState,
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        const { result } = renderHook(() => useLobbyApi());

        await result.current.host({ gameId: 'tactics', maxPlayers: 4 });
        await result.current.join({ address: 'abc' });
        await result.current.updatePlayerReadyState(true);
        await result.current.startGame();
        await result.current.leave();

        expect(host).toHaveBeenCalledWith({ gameId: 'tactics', maxPlayers: 4 });
        expect(join).toHaveBeenCalledWith({ address: 'abc' });
        expect(getLocalPlayerId).toHaveBeenCalledWith();
        expect(updatePlayerReadyState).toHaveBeenCalledWith(true);
        expect(startGame).toHaveBeenCalledWith();
        expect(leave).toHaveBeenCalledWith();
    });

    it('sets authoritative single-seat local context after host and clears it after leave', async () => {
        const host = vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' }));
        const leave = vi.fn(async () => undefined);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host,
                    join: vi.fn(),
                    getLocalPlayerId: vi.fn(async () => 'p1'),
                    leave,
                    updatePlayerReadyState: vi.fn(),
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        const { result } = renderHook(() => useLobbyApi());

        await result.current.host({ gameId: 'tactics', maxPlayers: 4 });

        expect(useLobbyUiStore.getState().localPlayerId).toBe('p1');
        expect(useLobbyUiStore.getState().localSeatIds).toEqual(['p1']);

        await result.current.leave();

        expect(useLobbyUiStore.getState().localPlayerId).toBeNull();
        expect(useLobbyUiStore.getState().localSeatIds).toEqual([]);
    });

    it('does not collapse existing multi-seat local context after host', async () => {
        const host = vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' }));

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host,
                    join: vi.fn(),
                    getLocalPlayerId: vi.fn(async () => 'p1'),
                    leave: vi.fn(),
                    updatePlayerReadyState: vi.fn(),
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        useLobbyUiStore
            .getState()
            .setLocalLobbyContext(playerId('p1'), [playerId('p1'), playerId('p2')]);

        const { result } = renderHook(() => useLobbyApi());
        await result.current.host({ gameId: 'tactics', maxPlayers: 4 });

        expect(useLobbyUiStore.getState().localPlayerId).toBe(playerId('p1'));
        expect(useLobbyUiStore.getState().localSeatIds).toEqual([playerId('p1'), playerId('p2')]);
    });

    it('preserves host and join local seat context without collapsing to a single seat', async () => {
        const host = vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' }));
        const join = vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' }));
        const getLocalPlayerId = vi.fn(async () => 'player-2');

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host,
                    join,
                    getLocalPlayerId,
                    leave: vi.fn(),
                    updatePlayerReadyState: vi.fn(),
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        const { result } = renderHook(() => useLobbyApi());

        await result.current.host({ gameId: 'tactics', maxPlayers: 4 });
        expect(useLobbyUiStore.getState().localSeatIds).toEqual(['p1']);

        await result.current.join({ address: 'abc' });
        expect(useLobbyUiStore.getState().localSeatIds).toEqual(['player-2', 'p1']);
    });

    it('sets a single-seat local context after successful join using authoritative local player identity', async () => {
        const join = vi.fn(async () => ({ sessionId: 's', hostId: 'host-1', gameId: 'tactics' }));
        const getLocalPlayerId = vi.fn(async () => 'player-2');

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host: vi.fn(),
                    join,
                    getLocalPlayerId,
                    leave: vi.fn(),
                    updatePlayerReadyState: vi.fn(),
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        const { result } = renderHook(() => useLobbyApi());
        await result.current.join({ address: 'abc' });

        expect(getLocalPlayerId).toHaveBeenCalledOnce();
        expect(useLobbyUiStore.getState().localPlayerId).toBe('player-2');
        expect(useLobbyUiStore.getState().localSeatIds).toEqual(['player-2']);
    });

    it('does not collapse existing multi-seat local context after join', async () => {
        const join = vi.fn(async () => ({ sessionId: 's', hostId: 'host-1', gameId: 'tactics' }));
        const getLocalPlayerId = vi.fn(async () => 'player-2');

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host: vi.fn(),
                    join,
                    getLocalPlayerId,
                    leave: vi.fn(),
                    updatePlayerReadyState: vi.fn(),
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        useLobbyUiStore
            .getState()
            .setLocalLobbyContext(playerId('player-2'), [
                playerId('player-2'),
                playerId('player-3'),
            ]);

        const { result } = renderHook(() => useLobbyApi());
        await result.current.join({ address: 'abc' });

        expect(useLobbyUiStore.getState().localPlayerId).toBe(playerId('player-2'));
        expect(useLobbyUiStore.getState().localSeatIds).toEqual([
            playerId('player-2'),
            playerId('player-3'),
        ]);
    });

    it('rejects join when authoritative local identity is unavailable', async () => {
        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host: vi.fn(),
                    join: vi.fn(async () => ({
                        sessionId: 's',
                        hostId: 'host-1',
                        gameId: 'tactics',
                    })),
                    getLocalPlayerId: vi.fn(async () => null),
                    leave: vi.fn(),
                    updatePlayerReadyState: vi.fn(),
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        const { result } = renderHook(() => useLobbyApi());
        await expect(result.current.join({ address: 'abc' })).rejects.toThrow(
            'Chimera local player identity not available',
        );
    });

    it('throws when calling updatePlayerReadyState without preload bridge', async () => {
        const { result } = renderHook(() => useLobbyApi());

        await expect(result.current.updatePlayerReadyState(true)).rejects.toThrow(
            'Chimera API not available',
        );
    });

    it('throws when calling startGame without preload bridge', async () => {
        const { result } = renderHook(() => useLobbyApi());

        await expect(result.current.startGame()).rejects.toThrow('Chimera API not available');
    });

    it('delegates setMatchSetting and setPlayerAttribute to the bridge lobby API', async () => {
        const setMatchSetting = vi.fn(async () => undefined);
        const setPlayerAttribute = vi.fn(async () => undefined);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host: vi.fn(),
                    join: vi.fn(),
                    getLocalPlayerId: vi.fn(),
                    leave: vi.fn(),
                    startGame: vi.fn(),
                    updatePlayerReadyState: vi.fn(),
                    setMatchSetting,
                    setPlayerAttribute,
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        const { result } = renderHook(() => useLobbyApi());

        await result.current.setMatchSetting('boardColor', 'amber');
        await result.current.setPlayerAttribute(playerId('p2'), 'color', 'blue');

        expect(setMatchSetting).toHaveBeenCalledWith('boardColor', 'amber');
        expect(setPlayerAttribute).toHaveBeenCalledWith(playerId('p2'), 'color', 'blue');
    });

    it('delegates addAiPlayer and removeAiPlayer to the bridge lobby API', async () => {
        const addAi = vi.fn(async () => undefined);
        const removeAi = vi.fn(async () => undefined);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host: vi.fn(),
                    join: vi.fn(),
                    getLocalPlayerId: vi.fn(),
                    leave: vi.fn(),
                    startGame: vi.fn(),
                    updatePlayerReadyState: vi.fn(),
                    addAi,
                    removeAi,
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        const { result } = renderHook(() => useLobbyApi());

        await result.current.addAiPlayer();
        await result.current.removeAiPlayer(2);

        expect(addAi).toHaveBeenCalledTimes(1);
        expect(removeAi).toHaveBeenCalledWith(2);
    });

    it('throws when calling addAiPlayer or removeAiPlayer without preload bridge', async () => {
        const { result } = renderHook(() => useLobbyApi());

        await expect(result.current.addAiPlayer()).rejects.toThrow('Chimera API not available');
        await expect(result.current.removeAiPlayer(1)).rejects.toThrow('Chimera API not available');
    });

    it('throws when calling setMatchSetting without preload bridge', async () => {
        const { result } = renderHook(() => useLobbyApi());

        await expect(result.current.setMatchSetting('boardColor', 'amber')).rejects.toThrow(
            'Chimera API not available',
        );
    });

    it('throws when calling setPlayerAttribute without preload bridge', async () => {
        const { result } = renderHook(() => useLobbyApi());

        await expect(
            result.current.setPlayerAttribute(playerId('p2'), 'color', 'blue'),
        ).rejects.toThrow('Chimera API not available');
    });
});
