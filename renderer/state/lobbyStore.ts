/**
 * renderer/state/lobbyStore.ts
 *
 * Zustand store for multiplayer lobby state.
 *
 * Architecture reference: §F12/T01 (issue #268), §renderer/state/lobbyStore.ts
 *
 * Rules:
 *  - Components subscribe through narrow typed selectors only (renderer.instructions.md)
 *  - _applyLobbyState() is called by IPC listeners; do NOT call from components
 *  - This store mirrors authoritative lobby state from IPC only
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { LobbyState } from '@chimera/shared/messages-schemas.js';

// ── Store shape ───────────────────────────────────────────────────────────────

export interface LobbyStoreState {
    /** Current lobby state, or null if not in a lobby. */
    readonly lobbyState: LobbyState | null;

    /**
     * Apply incoming lobby state from IPC (chimera:lobby-update push).
     * Do NOT call from components directly.
     */
    _applyLobbyState(state: LobbyState | null): void;
}

// ── Factory (for testing and production use) ──────────────────────────────────

/**
 * Create an isolated store instance.
 */
export function createLobbyStore(): StoreApi<LobbyStoreState> {
    return createStore<LobbyStoreState>()((set) => ({
        lobbyState: null,

        _applyLobbyState(state: LobbyState | null): void {
            set(() => ({
                lobbyState: state,
            }));
        },
    }));
}

// ── Singleton store ───────────────────────────────────────────────────────────

const lobbyStoreInstance = createLobbyStore();

/**
 * Zustand hook for the lobby store.
 *
 * Always subscribe via a narrow selector:
 *
 * ```typescript
 * // ✅ Narrow selector
 * const lobbyState = useLobbyStore(s => s.lobbyState);
 * ```
 */
export function useLobbyStore<T>(selector: (state: LobbyStoreState) => T): T {
    return useStore(lobbyStoreInstance, selector);
}

// Expose static accessors for direct store access (IPC wiring, tests)
useLobbyStore.getState = lobbyStoreInstance.getState.bind(lobbyStoreInstance);
useLobbyStore.setState = lobbyStoreInstance.setState.bind(lobbyStoreInstance);
useLobbyStore.subscribe = lobbyStoreInstance.subscribe.bind(lobbyStoreInstance);
