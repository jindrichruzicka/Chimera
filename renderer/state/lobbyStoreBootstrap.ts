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

import type { LobbyAPI, SystemAPI, Unsubscribe } from '../../electron/preload/api-types';
import { useLobbyStore } from './lobbyStore';
import { useLobbyUiStore } from './lobbyUiStore';

/**
 * Register the `onUpdate` push listener on the supplied lobby API and route
 * incoming lobby state events into the lobbyStore via `_applyLobbyState`.
 * Also register the `onConnectionStatus` listener on the system API and
 * call `_applyLobbyState(null)` when status is 'disconnected'.
 *
 * Returns the unsubscribe function from the lobby API so the caller can clean
 * up when the component unmounts or the bridge is replaced.
 */
export function bootstrapLobbyStore(lobbyApi: LobbyAPI, systemApi: SystemAPI): Unsubscribe {
    // Subscribe to lobby updates
    const unsubscribeLobby = lobbyApi.onUpdate((lobbyState) => {
        useLobbyStore.getState()._applyLobbyState(lobbyState);
    });

    // Subscribe to connection status changes
    const unsubscribeSystem = systemApi.onConnectionStatus((status) => {
        if (status === 'disconnected') {
            useLobbyStore.getState()._applyLobbyState(null);
            useLobbyUiStore.getState().clearLocalLobbyContext();
        }
    });

    // Return a combined unsubscribe function that unsubscribes from both
    return () => {
        unsubscribeLobby();
        unsubscribeSystem();
    };
}
