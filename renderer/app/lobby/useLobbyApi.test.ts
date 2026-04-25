// renderer/app/lobby/useLobbyApi.test.ts
// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLobbyBridge, useLobbyApi } from './useLobbyApi';

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

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host,
                    join,
                    leave,
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
        await result.current.leave();

        expect(host).toHaveBeenCalledWith({ gameId: 'tactics', maxPlayers: 4 });
        expect(join).toHaveBeenCalledWith({ address: 'abc' });
        expect(leave).toHaveBeenCalledWith();
    });
});
