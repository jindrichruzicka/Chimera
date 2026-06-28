'use client';

import { useCallback } from 'react';
import type { LobbyAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import { useLobbyStore } from '../state/lobbyStore.js';
import { useLobbyUiStore } from '../state/lobbyUiStore.js';

/**
 * Role-aware "leave the match" action handed to in-game menu components through
 * `InGameMenuProps.leaveGame`. The menu reaches the engine only through the
 * registry-supplied setter and never opens IPC channels itself (Invariant #80 —
 * registry indirection for the `inGameMenu` slot; the in-game-menu analogue of
 * Invariant #100, which governs game lobby screens). A host abandons the match
 * back to the lobby; a client records its leaving-to-main-menu intent and
 * disconnects.
 */
export type LeaveGame = () => Promise<void>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isLeaveCapableLobby(value: Readonly<Record<string, unknown>>): boolean {
    return typeof value['leave'] === 'function' && typeof value['returnToLobby'] === 'function';
}

// Self-contained bridge resolver mirroring useSendAction's resolveSendAction.
// Intentionally not reusing getLobbyBridge() from useLobbyApi: that helper also
// requires __chimera.system, an unrelated dependency this hook never touches.
function resolveLobbyApi(source: unknown): LobbyAPI | undefined {
    if (!isRecord(source)) {
        return undefined;
    }
    const chimera = source['__chimera'];
    if (!isRecord(chimera)) {
        return undefined;
    }
    const lobby = chimera['lobby'];
    if (!isRecord(lobby) || !isLeaveCapableLobby(lobby)) {
        return undefined;
    }
    return lobby as unknown as LobbyAPI;
}

/**
 * Sibling of {@link useSendAction}: resolves the local player's role from lobby
 * state and routes a leave through the preload lobby bridge. The renderer never
 * opens IPC channels itself — the host path calls `returnToLobby()`, the client
 * path flags the leaving-to-main-menu intent then calls `leave()`.
 */
export function useLeaveGame(source: unknown = globalThis): LeaveGame {
    const hostId = useLobbyStore((state) => state.lobbyState?.info.hostId ?? null);
    const localPlayerId = useLobbyUiStore((state) => state.localPlayerId);
    const isHost = hostId !== null && localPlayerId !== null && hostId === localPlayerId;

    return useCallback(async (): Promise<void> => {
        const lobby = resolveLobbyApi(source);
        if (lobby === undefined) {
            throw new Error('Chimera lobby API not available');
        }
        if (isHost) {
            await lobby.returnToLobby();
            return;
        }
        // Client disconnect: flag the leaving-to-main-menu intent for routing
        // (which owns navigation and local-context reset, F55) and call the raw
        // bridge leave(). Unlike useLobbyApi().leave(), this deliberately does not
        // clearLocalLobbyContext() — that reset belongs to the routing task, so
        // this hook stays a pure leave capability.
        useLobbyUiStore.getState().setLeavingToMainMenu(true);
        await lobby.leave();
    }, [source, isHost]);
}
