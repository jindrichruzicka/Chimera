/**
 * renderer/state/lobbyUiStore.ts
 *
 * Local-only lobby UI metadata store.
 * This store is intentionally separate from lobbyStore, which mirrors
 * authoritative LobbyState pushed from IPC.
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { PlayerId } from '@chimera/electron/preload/api-types.js';

export interface LobbyUiStoreState {
    /** Local player identity used for renderer-only affordances. */
    readonly localPlayerId: PlayerId | null;

    /** Local pass-and-play seat IDs available on this device. */
    readonly localSeatIds: readonly PlayerId[];

    /** Set local-only player and seat metadata after a successful host/join intent. */
    setLocalLobbyContext(localPlayerId: PlayerId | null, localSeatIds: readonly PlayerId[]): void;

    /** Clear local-only metadata when leaving or disconnecting from a lobby. */
    clearLocalLobbyContext(): void;
}

export function createLobbyUiStore(): StoreApi<LobbyUiStoreState> {
    return createStore<LobbyUiStoreState>()((set) => ({
        localPlayerId: null,
        localSeatIds: [],

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
    }));
}

const lobbyUiStoreInstance = createLobbyUiStore();

export function useLobbyUiStore<T>(selector: (state: LobbyUiStoreState) => T): T {
    return useStore(lobbyUiStoreInstance, selector);
}

useLobbyUiStore.getState = lobbyUiStoreInstance.getState.bind(lobbyUiStoreInstance);
useLobbyUiStore.setState = lobbyUiStoreInstance.setState.bind(lobbyUiStoreInstance);
useLobbyUiStore.subscribe = lobbyUiStoreInstance.subscribe.bind(lobbyUiStoreInstance);
