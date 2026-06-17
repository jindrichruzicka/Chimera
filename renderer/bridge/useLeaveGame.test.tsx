// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerId } from '@chimera/electron/preload/api-types.js';
import type { LobbyState } from '@chimera/shared/messages-schemas.js';
import { useLeaveGame } from './useLeaveGame';
import { useLobbyStore } from '../state/lobbyStore';
import { useLobbyUiStore } from '../state/lobbyUiStore';

function makeLobbyState(hostId: string): LobbyState {
    return {
        info: { sessionId: 'session-1', hostId: playerId(hostId), gameId: 'tactics' },
        players: [],
    };
}

interface LobbyBridgeMock {
    readonly leave: ReturnType<typeof vi.fn>;
    readonly returnToLobby: ReturnType<typeof vi.fn>;
}

function makeSource(lobby: LobbyBridgeMock): unknown {
    return { __chimera: { lobby } };
}

function makeLobbyBridge(): LobbyBridgeMock {
    return {
        leave: vi.fn(async () => undefined),
        returnToLobby: vi.fn(async () => undefined),
    };
}

describe('useLeaveGame', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        useLobbyStore.getState().applyLobbyState(null);
        useLobbyUiStore.getState().clearLocalLobbyContext();
        useLobbyUiStore.getState().setLeavingToMainMenu(false);
    });

    it('invokes returnToLobby() and leaves the intent flag untouched when the local player hosts', async () => {
        useLobbyStore.getState().applyLobbyState(makeLobbyState('p1'));
        useLobbyUiStore.getState().setLocalLobbyContext(playerId('p1'), [playerId('p1')]);
        const lobby = makeLobbyBridge();

        const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
        await result.current();

        expect(lobby.returnToLobby).toHaveBeenCalledOnce();
        expect(lobby.leave).not.toHaveBeenCalled();
        expect(useLobbyUiStore.getState().leavingToMainMenu).toBe(false);
    });

    it('sets the leaving-to-main-menu intent flag and invokes leave() for a client', async () => {
        useLobbyStore.getState().applyLobbyState(makeLobbyState('p1'));
        useLobbyUiStore.getState().setLocalLobbyContext(playerId('p2'), [playerId('p2')]);
        const lobby = makeLobbyBridge();

        const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
        await result.current();

        expect(useLobbyUiStore.getState().leavingToMainMenu).toBe(true);
        expect(lobby.leave).toHaveBeenCalledOnce();
        expect(lobby.returnToLobby).not.toHaveBeenCalled();
    });

    it('treats a missing lobby state as a non-host (client) leave', async () => {
        useLobbyUiStore.getState().setLocalLobbyContext(playerId('p2'), [playerId('p2')]);
        const lobby = makeLobbyBridge();

        const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
        await result.current();

        expect(lobby.leave).toHaveBeenCalledOnce();
        expect(lobby.returnToLobby).not.toHaveBeenCalled();
        expect(useLobbyUiStore.getState().leavingToMainMenu).toBe(true);
    });

    it('treats a host id that differs from the local player as a client leave', async () => {
        useLobbyStore.getState().applyLobbyState(makeLobbyState('host'));
        useLobbyUiStore.getState().setLocalLobbyContext(playerId('client'), [playerId('client')]);
        const lobby = makeLobbyBridge();

        const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
        await result.current();

        expect(lobby.leave).toHaveBeenCalledOnce();
        expect(lobby.returnToLobby).not.toHaveBeenCalled();
    });

    it('rejects with the bridge-unavailable error when the lobby API is missing', async () => {
        const { result } = renderHook(() => useLeaveGame(null));

        await expect(result.current()).rejects.toThrow('Chimera lobby API not available');
    });
});
