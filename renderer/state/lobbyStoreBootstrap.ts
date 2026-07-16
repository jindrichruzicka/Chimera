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

async function hydrateSessionRoleFromMain(
    lobbyApi: Pick<LobbyAPI, 'getLocalRole'>,
    isActive: () => boolean,
    isCurrent: () => boolean,
): Promise<boolean> {
    // The session role is fixed once assigned (host/join) — unlike the seat
    // context it is keyed to the connection, not the roster, so a spectator
    // (absent from `lobbyState.players`) still hydrates its role here
    // (Invariant #114).
    const role = await lobbyApi.getLocalRole();
    // Drop a stale resolve: if a disconnect / fresher event landed while this
    // IPC was in flight, applying the old role would re-latch a dead session's
    // role and block the next session from re-hydrating. Mirrors the replay
    // path's freshness guard rather than the coarser `active` flag alone.
    if (!isActive() || !isCurrent()) {
        return false;
    }
    useLobbyUiStore.getState().setLocalRole(role);
    return true;
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
    lobbyApi: Pick<LobbyAPI, 'getCurrentState' | 'getLocalPlayerId' | 'getLocalRole' | 'onUpdate'>,
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

    // Gate concurrent getLocalPlayerId IPC calls with an in-flight flag.
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

    // The session role is fetched once per session (fixed for its lifetime) and
    // reset on disconnect so the next session re-hydrates. Gate with a resolved
    // flag + in-flight flag so repeated lobby updates issue only one IPC call.
    let roleHydrated = false;
    let roleHydrateInFlight = false;
    function tryHydrateRole(): void {
        if (roleHydrated || roleHydrateInFlight) {
            return;
        }
        roleHydrateInFlight = true;
        // Pin the freshness epoch at dispatch so a disconnect / fresher event
        // that lands mid-flight invalidates this hydrate (see the guard inside
        // hydrateSessionRoleFromMain) rather than latching a stale role.
        const dispatchEpoch = freshnessEpoch;
        const isRoleHydrateCurrent = (): boolean => dispatchEpoch === freshnessEpoch;
        void hydrateSessionRoleFromMain(lobbyApi, isActive, isRoleHydrateCurrent)
            .then((didSet) => {
                if (didSet) {
                    roleHydrated = true;
                }
            })
            .finally(() => {
                roleHydrateInFlight = false;
            });
    }

    const unsubscribeLobby = lobbyApi.onUpdate((lobbyState) => {
        markFresherEvent();
        useLobbyStore.getState().applyLobbyState(lobbyState);
        syncLocalSeatsFromLobbyState(lobbyState);
        tryHydrateLocalPlayer(lobbyState);
        tryHydrateRole();
    });

    void lobbyApi
        .getCurrentState()
        .then((lobbyState) => {
            if (!active) {
                return;
            }
            // Only apply replay while bootstrap freshness is still current. A
            // fresher push/disconnect/error event invalidates this replay response.
            if (isReplayCurrent()) {
                useLobbyStore.getState().applyLobbyState(lobbyState);
                if (lobbyState !== null) {
                    syncLocalSeatsFromLobbyState(lobbyState);
                    tryHydrateLocalPlayer(lobbyState);
                    tryHydrateRole();
                }
            }
            useLobbyStore.getState().markInitialStateLoaded();
        })
        .catch((err: unknown) => {
            if (active) {
                // Log the error so schema drift / main-process bugs are
                // observable in production rather than silently swallowed.
                console.warn('[lobbyStoreBootstrap] Failed to replay lobby state:', err);
                if (isReplayCurrent()) {
                    useLobbyStore.getState().applyLobbyState(null);
                }
                useLobbyStore.getState().markInitialStateLoaded();
            }
        });

    const unsubscribeSystem = systemApi.onConnectionStatus((status) => {
        if (status === 'disconnected' || status === 'error') {
            markFresherEvent();
            useLobbyStore.getState().applyLobbyState(null);
            useLobbyUiStore.getState().clearLocalLobbyContext();
            // Role is session-scoped: reset it (and re-arm hydration) so a
            // subsequent host/join session re-fetches its own role. Clear the
            // in-flight flag too — a hydrate still pending from the dead session
            // is now epoch-stale and must not block the next session's fetch.
            useLobbyUiStore.getState().setLocalRole('player');
            roleHydrated = false;
            roleHydrateInFlight = false;
        }
    });

    return () => {
        active = false;
        unsubscribeLobby();
        unsubscribeSystem();
    };
}
