/**
 * renderer/state/lobbyUiStore.ts
 *
 * Local-only lobby UI metadata store.
 * This store is intentionally separate from lobbyStore, which mirrors
 * authoritative LobbyState pushed from IPC.
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { PlayerId } from '@chimera-engine/simulation/bridge/api-types.js';

export interface LobbyUiStoreState {
    /** Local player identity used for renderer-only affordances. */
    readonly localPlayerId: PlayerId | null;

    /** Local pass-and-play seat IDs available on this device. */
    readonly localSeatIds: readonly PlayerId[];

    /**
     * The authoritative role of the local session (`'player'` | `'spectator'`),
     * hydrated from the main process (Invariant #114). Distinct from the seat
     * context above: a spectator has a role but no seat and is absent from the
     * lobby roster, so it is reset explicitly on disconnect — not by
     * {@link clearLocalLobbyContext}, which only clears seat metadata.
     */
    readonly role: 'player' | 'spectator';

    /**
     * Renderer-only intent: the local player is leaving the active match for the
     * main menu (client leave path). Routing consumes and resets this flag after
     * navigating; it is independent of the IPC-mirrored lobby state.
     */
    readonly leavingToMainMenu: boolean;

    /** Set local-only player and seat metadata after a successful host/join intent. */
    setLocalLobbyContext(localPlayerId: PlayerId | null, localSeatIds: readonly PlayerId[]): void;

    /** Clear local-only seat metadata when leaving or disconnecting from a lobby. */
    clearLocalLobbyContext(): void;

    /** Set the authoritative session role, hydrated from the main process. */
    setLocalRole(role: 'player' | 'spectator'): void;

    /** Set the leaving-to-main-menu intent flag (set on client leave, reset by routing). */
    setLeavingToMainMenu(leaving: boolean): void;
}

export function createLobbyUiStore(): StoreApi<LobbyUiStoreState> {
    return createStore<LobbyUiStoreState>()((set) => ({
        localPlayerId: null,
        localSeatIds: [],
        role: 'player',
        leavingToMainMenu: false,

        setLocalLobbyContext(
            localPlayerId: PlayerId | null,
            localSeatIds: readonly PlayerId[],
        ): void {
            set(() => ({
                localPlayerId,
                localSeatIds: [...localSeatIds],
            }));
        },

        clearLocalLobbyContext(): void {
            set(() => ({
                localPlayerId: null,
                localSeatIds: [],
            }));
        },

        setLocalRole(role: 'player' | 'spectator'): void {
            set(() => ({ role }));
        },

        setLeavingToMainMenu(leaving: boolean): void {
            set(() => ({
                leavingToMainMenu: leaving,
            }));
        },
    }));
}

const lobbyUiStoreInstance = createLobbyUiStore();

export function useLobbyUiStore<T>(selector: (state: LobbyUiStoreState) => T): T {
    return useStore(lobbyUiStoreInstance, selector);
}

useLobbyUiStore.getState = lobbyUiStoreInstance.getState.bind(lobbyUiStoreInstance);
useLobbyUiStore.setState = lobbyUiStoreInstance.setState.bind(lobbyUiStoreInstance);
useLobbyUiStore.subscribe = lobbyUiStoreInstance.subscribe.bind(lobbyUiStoreInstance);

/**
 * True when the local session is a read-only spectator (Invariant #114). Narrow
 * selector over {@link LobbyUiStoreState.role} so components re-render only on a
 * role change, not on every seat-context update.
 */
export function useIsSpectator(): boolean {
    return useLobbyUiStore((state) => state.role === 'spectator');
}
