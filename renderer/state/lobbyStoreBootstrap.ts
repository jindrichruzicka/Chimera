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
    PlayerId,
    SystemAPI,
    Unsubscribe,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
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

function lobbyPlayerIds(lobbyState: LobbyState): readonly PlayerId[] {
    return lobbyState.players.map((player) => playerId(player.playerId));
}

function syncLocalPlayerFromLobbyState(localPlayerId: PlayerId, lobbyState: LobbyState): void {
    const playerIds = lobbyPlayerIds(lobbyState);
    if (!playerIds.includes(localPlayerId)) {
        useLobbyUiStore.getState().clearLocalLobbyContext();
        return;
    }
    useLobbyUiStore.getState().setLocalLobbyContext(localPlayerId, playerIds);
}

async function hydrateLocalPlayerFromMain(
    lobbyApi: Pick<LobbyAPI, 'getLocalPlayerId'>,
    lobbyState: LobbyState,
    isActive: () => boolean,
): Promise<void> {
    if (useLobbyUiStore.getState().localPlayerId !== null) {
        return;
    }

    const localPlayerId = await lobbyApi.getLocalPlayerId();
    if (!isActive() || localPlayerId === null) {
        return;
    }

    syncLocalPlayerFromLobbyState(localPlayerId, lobbyState);
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
    lobbyApi: Pick<LobbyAPI, 'getCurrentState' | 'getLocalPlayerId' | 'onUpdate'>,
    systemApi: Pick<SystemAPI, 'onConnectionStatus'>,
): Unsubscribe {
    let active = true;
    const isActive = (): boolean => active;
    let freshnessEpoch = 0;
    const markFresherEvent = (): void => {
        freshnessEpoch += 1;
    };

    const replayEpoch = freshnessEpoch;
    const isReplayCurrent = (): boolean => replayEpoch === freshnessEpoch;

    useLobbyStore.getState().markInitialStateLoading();

    // WARN-3: gate concurrent getLocalPlayerId IPC calls with an in-flight flag.
    let hydrateInFlight = false;
    function tryHydrateLocalPlayer(lobbyState: LobbyState): void {
        if (hydrateInFlight) {
            return;
        }
        hydrateInFlight = true;
        void hydrateLocalPlayerFromMain(lobbyApi, lobbyState, isActive).finally(() => {
            hydrateInFlight = false;
        });
    }

    // Subscribe to lobby updates
    const unsubscribeLobby = lobbyApi.onUpdate((lobbyState) => {
        markFresherEvent();
        useLobbyStore.getState().applyLobbyState(lobbyState);
        syncLocalSeatsFromLobbyState(lobbyState);
        tryHydrateLocalPlayer(lobbyState);
    });

    void lobbyApi
        .getCurrentState()
        .then((lobbyState) => {
            if (!active) {
                return;
            }
            // WARN-1: only apply replay while bootstrap freshness is still current.
            // A fresher push/disconnect/error event invalidates this replay response.
            if (isReplayCurrent()) {
                useLobbyStore.getState().applyLobbyState(lobbyState);
                if (lobbyState !== null) {
                    syncLocalSeatsFromLobbyState(lobbyState);
                    tryHydrateLocalPlayer(lobbyState);
                }
            }
            useLobbyStore.getState().markInitialStateLoaded();
        })
        .catch((err: unknown) => {
            if (active) {
                // WARN-2: log the error so schema drift / main-process bugs are
                // observable in production rather than silently swallowed.
                console.warn('[lobbyStoreBootstrap] Failed to replay lobby state:', err);
                if (isReplayCurrent()) {
                    useLobbyStore.getState().applyLobbyState(null);
                }
                useLobbyStore.getState().markInitialStateLoaded();
            }
        });

    // Subscribe to connection status changes
    const unsubscribeSystem = systemApi.onConnectionStatus((status) => {
        if (status === 'disconnected' || status === 'error') {
            markFresherEvent();
            useLobbyStore.getState().applyLobbyState(null);
            useLobbyUiStore.getState().clearLocalLobbyContext();
        }
    });

    // Return a combined unsubscribe function that unsubscribes from both
    return () => {
        active = false;
        unsubscribeLobby();
        unsubscribeSystem();
    };
}
