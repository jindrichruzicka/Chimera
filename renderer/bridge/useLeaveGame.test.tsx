// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import type { LobbyState } from '@chimera-engine/simulation/foundation/messages-schemas.js';
import {
    SESSION_MODE_QUICK,
    SESSION_MODE_SETTING,
} from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import { useLeaveGame } from './useLeaveGame';
import { useGameStore } from '../state/gameStore';
import { useLobbyStore } from '../state/lobbyStore';
import { useLobbyUiStore } from '../state/lobbyUiStore';

function makeLobbyState(hostId: string): LobbyState {
    return {
        info: { sessionId: 'session-1', hostId: playerId(hostId), gameId: 'tactics' },
        players: [],
    };
}

/**
 * A live match snapshot carrying `matchSettings` — the channel the session-mode
 * stamp rides (Invariant #101), and therefore the one that survives a window
 * reload and a restore.
 */
function applySnapshotWithSettings(matchSettings?: Readonly<Record<string, string>>): void {
    useGameStore.getState().applySnapshot({
        tick: 4,
        phase: 'playing',
        viewerId: 'p1',
        players: {},
        undoMeta: { canUndo: false, canRedo: false },
        ...(matchSettings === undefined ? {} : { setup: { matchSettings, playerAttributes: {} } }),
    } as unknown as PlayerSnapshot);
}

interface LobbyBridgeMock {
    readonly leave: ReturnType<typeof vi.fn>;
    readonly returnToLobby: ReturnType<typeof vi.fn>;
    readonly closeSession: ReturnType<typeof vi.fn>;
}

function makeSource(lobby: Partial<LobbyBridgeMock>): unknown {
    return { __chimera: { lobby } };
}

function makeLobbyBridge(): LobbyBridgeMock {
    return {
        leave: vi.fn(async () => undefined),
        returnToLobby: vi.fn(async () => undefined),
        closeSession: vi.fn(async () => undefined),
    };
}

/** Seat the local player as the lobby host. */
function seatAsHost(): void {
    useLobbyStore.getState().applyLobbyState(makeLobbyState('p1'));
    useLobbyUiStore.getState().setLocalLobbyContext(playerId('p1'), [playerId('p1')]);
}

describe('useLeaveGame', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        useGameStore.getState().reset();
        useLobbyStore.getState().applyLobbyState(null);
        useLobbyUiStore.getState().clearLocalLobbyContext();
        useLobbyUiStore.getState().setLeavingToMainMenu(false);
    });

    it('invokes returnToLobby() and leaves the intent flag untouched when the local player hosts', async () => {
        seatAsHost();
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

    it('rejects with the bridge-unavailable error when the bridge has no closeSession verb', async () => {
        const { leave, returnToLobby } = makeLobbyBridge();
        const { result } = renderHook(() => useLeaveGame(makeSource({ leave, returnToLobby })));

        await expect(result.current()).rejects.toThrow('Chimera lobby API not available');
    });

    describe('the quick-session fork', () => {
        it('closes the session and raises the main-menu intent when the stamp says quick', async () => {
            seatAsHost();
            applySnapshotWithSettings({ [SESSION_MODE_SETTING]: SESSION_MODE_QUICK });
            const lobby = makeLobbyBridge();

            const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
            await result.current();

            expect(lobby.closeSession).toHaveBeenCalledExactlyOnceWith({ autosave: true });
            expect(lobby.returnToLobby).not.toHaveBeenCalled();
            expect(useLobbyUiStore.getState().leavingToMainMenu).toBe(true);
        });

        it('forwards an explicit autosave: false — abandoning is the caller’s call', async () => {
            seatAsHost();
            applySnapshotWithSettings({ [SESSION_MODE_SETTING]: SESSION_MODE_QUICK });
            const lobby = makeLobbyBridge();

            const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
            await result.current({ autosave: false });

            expect(lobby.closeSession).toHaveBeenCalledExactlyOnceWith({ autosave: false });
        });

        it('raises the intent only once the close resolves', async () => {
            // Unlike the client disconnect, nothing else navigates away from a
            // quick session, so a failed capture must leave the player on the
            // live match rather than on a main menu it never reached.
            seatAsHost();
            applySnapshotWithSettings({ [SESSION_MODE_SETTING]: SESSION_MODE_QUICK });
            const lobby = makeLobbyBridge();
            let release = (): void => {};
            lobby.closeSession.mockImplementation(
                () =>
                    new Promise<void>((resolve) => {
                        release = resolve;
                    }),
            );

            const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
            const pending = result.current();
            await Promise.resolve();

            expect(lobby.closeSession).toHaveBeenCalledOnce();
            expect(useLobbyUiStore.getState().leavingToMainMenu).toBe(false);

            release();
            await pending;

            expect(useLobbyUiStore.getState().leavingToMainMenu).toBe(true);
        });

        it('leaves the flag down and propagates the failure when the close rejects', async () => {
            seatAsHost();
            applySnapshotWithSettings({ [SESSION_MODE_SETTING]: SESSION_MODE_QUICK });
            const lobby = makeLobbyBridge();
            lobby.closeSession.mockRejectedValue(new Error('no hosted session is active'));

            const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));

            await expect(result.current()).rejects.toThrow('no hosted session is active');
            expect(useLobbyUiStore.getState().leavingToMainMenu).toBe(false);
        });

        it('returns a session whose snapshot carries no setup at all to the lobby', async () => {
            // Older fixtures and games with no lobby setup: `setup` is optional
            // on the snapshot, so the read must survive its absence, not just
            // the key's.
            seatAsHost();
            applySnapshotWithSettings();
            const lobby = makeLobbyBridge();

            const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
            await result.current();

            expect(lobby.returnToLobby).toHaveBeenCalledOnce();
            expect(lobby.closeSession).not.toHaveBeenCalled();
            expect(useLobbyUiStore.getState().leavingToMainMenu).toBe(false);
        });

        it('returns a session whose setup has settings but no stamp to the lobby', async () => {
            // The shape a save written before the stamp existed restores into:
            // a populated `setup.matchSettings` with no session-mode key. The
            // documented degraded default — such a session keeps lobby semantics.
            seatAsHost();
            applySnapshotWithSettings({ mapSize: 'medium' });
            const lobby = makeLobbyBridge();

            const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
            await result.current();

            expect(lobby.returnToLobby).toHaveBeenCalledOnce();
            expect(lobby.closeSession).not.toHaveBeenCalled();
        });

        it('reads the stamp VALUE, not merely the key', async () => {
            seatAsHost();
            applySnapshotWithSettings({ [SESSION_MODE_SETTING]: 'lobby' });
            const lobby = makeLobbyBridge();

            const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
            await result.current();

            expect(lobby.returnToLobby).toHaveBeenCalledOnce();
            expect(lobby.closeSession).not.toHaveBeenCalled();
        });

        it('re-reads the stamp when it arrives AFTER the hook mounted', async () => {
            // Every other case here allocates a fresh `source` inside the render
            // callback, which invalidates the callback memo on every render and
            // hides whatever its dependency list does or does not carry. In
            // production the source is the stable `globalThis` default, so the
            // memo really holds — and the snapshot lands after the mount, since
            // the hook is mounted by the in-game menu of a match already running.
            seatAsHost();
            const lobby = makeLobbyBridge();
            const source = makeSource(lobby);

            const { result, rerender } = renderHook(() => useLeaveGame(source));
            act(() => {
                applySnapshotWithSettings({ [SESSION_MODE_SETTING]: SESSION_MODE_QUICK });
            });
            rerender();
            await result.current();

            expect(lobby.closeSession).toHaveBeenCalledExactlyOnceWith({ autosave: true });
            expect(lobby.returnToLobby).not.toHaveBeenCalled();
        });

        it('keeps a joined client on the leave path even inside a quick-stamped match', async () => {
            useLobbyStore.getState().applyLobbyState(makeLobbyState('host'));
            useLobbyUiStore.getState().setLocalLobbyContext(playerId('p2'), [playerId('p2')]);
            applySnapshotWithSettings({ [SESSION_MODE_SETTING]: SESSION_MODE_QUICK });
            const lobby = makeLobbyBridge();

            const { result } = renderHook(() => useLeaveGame(makeSource(lobby)));
            await result.current();

            expect(lobby.leave).toHaveBeenCalledOnce();
            expect(lobby.closeSession).not.toHaveBeenCalled();
        });
    });
});
