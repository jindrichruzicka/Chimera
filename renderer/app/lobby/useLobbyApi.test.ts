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
            getLocalPlayerId: vi.fn(),
            leave: vi.fn(),
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
        const updatePlayerReadyState = vi.fn(async () => undefined);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host,
                    join,
                    getLocalPlayerId,
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
        expect(getLocalPlayerId).toHaveBeenCalledWith();
        expect(updatePlayerReadyState).toHaveBeenCalledWith(true);
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

    it('keeps host and join local seat modeling consistent (authoritative single seat)', async () => {
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
        expect(useLobbyUiStore.getState().localSeatIds).toEqual(['player-2']);
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
});
