/**
 * renderer/state/lobbyStoreBootstrap.ts
 *
 * Side-effect-free bootstrap function that wires the chimera:lobby:update
 * push channel into the lobbyStore singleton.
 *
 * Usage (from a 'use client' component's useEffect):
 *
 *   const stop = bootstrapLobbyStore(window.__chimera.lobby, window.__chimera.system);
 *   return stop; // cleanup on unmount
 *
 * Architecture reference: §F12/T02 (issue #269)
 *
 * Invariant #1: LobbyState (not GameSnapshot) is what crosses IPC.
 */

import type {
    LobbyAPI,
    LobbyState,
    SystemAPI,
    Unsubscribe,
} from '../../electron/preload/api-types';
import { playerId } from '@chimera/electron/preload/api-types.js';
import { useLobbyStore } from './lobbyStore';
import { useLobbyUiStore } from './lobbyUiStore';

function syncLocalSeatsFromLobbyState(lobbyState: LobbyState): void {
    const { localPlayerId } = useLobbyUiStore.getState();

    if (localPlayerId === null) {
        return;
    }

    const lobbyPlayerIds = lobbyState.players.map((player) => playerId(player.playerId));

    if (!lobbyPlayerIds.includes(localPlayerId)) {
        useLobbyUiStore.getState().clearLocalLobbyContext();
        return;
    }

    useLobbyUiStore.getState().setLocalLobbyContext(localPlayerId, lobbyPlayerIds);
}

/**
 * Register the `onUpdate` push listener on the supplied lobby API and route
 * incoming lobby state events into the lobbyStore via `_applyLobbyState`.
 * Also register the `onConnectionStatus` listener on the system API and
 * call `_applyLobbyState(null)` when status is 'disconnected'.
 *
 * Returns the unsubscribe function from the lobby API so the caller can clean
 * up when the component unmounts or the bridge is replaced.
 */
export function bootstrapLobbyStore(
    lobbyApi: Pick<LobbyAPI, 'onUpdate'>,
    systemApi: Pick<SystemAPI, 'onConnectionStatus'>,
): Unsubscribe {
    // Subscribe to lobby updates
    const unsubscribeLobby = lobbyApi.onUpdate((lobbyState) => {
        useLobbyStore.getState().applyLobbyState(lobbyState);
        syncLocalSeatsFromLobbyState(lobbyState);
    });

    // Subscribe to connection status changes
    const unsubscribeSystem = systemApi.onConnectionStatus((status) => {
        if (status === 'disconnected') {
            useLobbyStore.getState().applyLobbyState(null);
            useLobbyUiStore.getState().clearLocalLobbyContext();
        }
    });

    // Return a combined unsubscribe function that unsubscribes from both
    return () => {
        unsubscribeLobby();
        unsubscribeSystem();
    };
}
