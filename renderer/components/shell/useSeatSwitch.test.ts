// renderer/components/shell/useSeatSwitch.test.ts
// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry, LogErrorInfo } from '@chimera/shared/logging.js';
import { getSeatSwitchBridge, useSeatSwitch } from './useSeatSwitch';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { playerId } from '@chimera/electron/preload/api-types.js';

describe('getSeatSwitchBridge', () => {
    it('returns null when game/lobby/logs bridge namespaces are unavailable', () => {
        expect(getSeatSwitchBridge({})).toBeNull();
    });

    it('returns typed game, lobby, and logs namespaces when present', () => {
        const game = {
            sendAction: vi.fn(),
            onSnapshot: vi.fn(),
            onActionRejected: vi.fn(),
            switchActiveSeat: vi.fn(),
        };
        const lobby = {
            host: vi.fn(),
            join: vi.fn(),
            leave: vi.fn(),
            getLocalPlayerId: vi.fn(async () => 'p1'),
            updatePlayerReadyState: vi.fn(),
            onUpdate: vi.fn(),
        };
        const logs = {
            emit: vi.fn(),
            readRecent: vi.fn(async () => []),
        };

        expect(
            getSeatSwitchBridge({
                __chimera: {
                    game,
                    lobby,
                    logs,
                },
            }),
        ).toEqual({ game, lobby, logs });
    });
});

describe('useSeatSwitch', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(globalThis, '__chimera');
    });

    it('delegates seat switching through the typed game API', async () => {
        const switchActiveSeat = vi.fn(async () => undefined);
        const getLocalPlayerId = vi.fn(async () => playerId('p2'));
        const emit = vi.fn();

        useLobbyUiStore
            .getState()
            .setLocalLobbyContext(playerId('p1'), [playerId('p1'), playerId('p2')]);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                game: {
                    sendAction: vi.fn(),
                    onSnapshot: vi.fn(),
                    onActionRejected: vi.fn(),
                    switchActiveSeat,
                },
                lobby: {
                    host: vi.fn(),
                    join: vi.fn(),
                    leave: vi.fn(),
                    getLocalPlayerId,
                    updatePlayerReadyState: vi.fn(),
                    onUpdate: vi.fn(),
                },
                logs: {
                    emit,
                    readRecent: vi.fn(async () => []),
                },
            },
        });

        const { result } = renderHook(() => useSeatSwitch());
        await result.current.switchSeat(playerId('p2'));

        expect(switchActiveSeat).toHaveBeenCalledWith(playerId('p2'));
        expect(getLocalPlayerId).toHaveBeenCalledOnce();
        expect(useLobbyUiStore.getState().localPlayerId).toBe(playerId('p2'));
        expect(emit).not.toHaveBeenCalled();
    });

    it('writes structured error logs when seat switching fails', async () => {
        const failure = new Error('switch failed');
        const switchActiveSeat = vi.fn(async () => {
            throw failure;
        });
        const getLocalPlayerId = vi.fn(async () => 'p2');
        const emit = vi.fn();

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                game: {
                    sendAction: vi.fn(),
                    onSnapshot: vi.fn(),
                    onActionRejected: vi.fn(),
                    switchActiveSeat,
                },
                lobby: {
                    host: vi.fn(),
                    join: vi.fn(),
                    leave: vi.fn(),
                    getLocalPlayerId,
                    updatePlayerReadyState: vi.fn(),
                    onUpdate: vi.fn(),
                },
                logs: {
                    emit,
                    readRecent: vi.fn(async () => []),
                },
            },
        });

        const { result } = renderHook(() => useSeatSwitch());
        await expect(result.current.switchSeat(playerId('p2'))).resolves.toBeUndefined();

        expect(emit).toHaveBeenCalledWith(
            expect.objectContaining<Partial<LogEntry>>({
                level: 'error',
                source: {
                    process: 'renderer',
                    module: 'seat-switcher',
                },
                context: {
                    playerId: 'p2',
                },
                error: expect.objectContaining<Partial<LogErrorInfo>>({
                    message: 'switch failed',
                }),
            }),
        );
    });
});
