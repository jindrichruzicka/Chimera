// renderer/app/lobby/useLobbyApi.test.ts
// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLobbyBridge, useLobbyApi } from './useLobbyApi';
import { useLobbyUiStore } from '../../state/lobbyUiStore';

describe('getLobbyBridge', () => {
    it('returns null when chimera bridge is unavailable', () => {
        const bridge = getLobbyBridge({});

        expect(bridge).toBeNull();
    });

    it('returns typed lobby and system APIs when present', () => {
        const lobby = {
            host: vi.fn(),
            join: vi.fn(),
            leave: vi.fn(),
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
        const leave = vi.fn(async () => undefined);
        const updatePlayerReadyState = vi.fn(async () => undefined);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host,
                    join,
                    leave,
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
        await result.current.leave();

        expect(host).toHaveBeenCalledWith({ gameId: 'tactics', maxPlayers: 4 });
        expect(join).toHaveBeenCalledWith({ address: 'abc' });
        expect(updatePlayerReadyState).toHaveBeenCalledWith(true);
        expect(leave).toHaveBeenCalledWith();
    });

    it('sets local lobby UI context after host and clears it after leave', async () => {
        const host = vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' }));
        const leave = vi.fn(async () => undefined);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host,
                    join: vi.fn(),
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
        expect(useLobbyUiStore.getState().localSeatIds).toEqual(['p1', 'p1-local-seat-2']);

        await result.current.leave();

        expect(useLobbyUiStore.getState().localPlayerId).toBeNull();
        expect(useLobbyUiStore.getState().localSeatIds).toEqual([]);
    });

    it('throws when updatePlayerReadyState is unavailable on the bridge', async () => {
        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host: vi.fn(),
                    join: vi.fn(),
                    leave: vi.fn(),
                    onUpdate: vi.fn(),
                },
                system: {
                    onConnectionStatus: vi.fn(),
                },
            },
        });

        const { result } = renderHook(() => useLobbyApi());

        await expect(result.current.updatePlayerReadyState(true)).rejects.toThrow(
            'Chimera lobby ready-state API not available',
        );
    });
});
