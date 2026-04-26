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
 *  - updateLobbyPlayerReadyState delegates through the injected chimera bridge
 *    (defaults to window.__chimera in the browser; overridable in tests)
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { LobbyState, PlayerId } from '@chimera/shared/messages-schemas.js';

// ── Store shape ───────────────────────────────────────────────────────────────

export interface LobbyStoreState {
    /** Current lobby state, or null if not in a lobby. */
    readonly lobbyState: LobbyState | null;

    /** The ID of the local player in the current lobby, or null if not in a lobby. */
    readonly localPlayerId: PlayerId | null;

    /** Local pass-and-play seat IDs available on this device. */
    readonly localSeatIds: readonly PlayerId[];

    /**
     * Apply incoming lobby state from IPC (chimera:lobby-update push).
     * Do NOT call from components directly.
     */
    _applyLobbyState(state: LobbyState | null): void;

    /**
     * Set the local player ID (called after host/join succeeds).
     * Internal method; do NOT call from components.
     */
    _setLocalPlayerId(playerId: PlayerId | null): void;

    /**
     * Set local pass-and-play seat IDs for renderer-only seat switching UI.
     * Internal method; do NOT call from components.
     */
    _setLocalSeatIds(playerIds: readonly PlayerId[]): void;

    /**
     * Update the ready state of the current player in the lobby.
     * Dispatches to main process; updates the lobby state in store.
     */
    updateLobbyPlayerReadyState(ready: boolean): Promise<void>;
}

// ── Factory (for testing and production use) ──────────────────────────────────

/**
 * Create an isolated store instance.  Pass a `bridge` in tests to avoid
 * relying on `window.__chimera`.  In production, the bridge is resolved
 * lazily from `window.__chimera` at call time so the store can be created
 * before the preload is ready.
 */
export function createLobbyStore(bridge?: {
    readonly lobby: {
        updatePlayerReadyState(ready: boolean): Promise<void>;
    };
}): StoreApi<LobbyStoreState> {
    return createStore<LobbyStoreState>()((set) => ({
        lobbyState: null,
        localPlayerId: null,
        localSeatIds: [],

        _applyLobbyState(state: LobbyState | null): void {
            set((currentState) => ({
                lobbyState: state,
                // Clear local player ID when leaving a lobby, otherwise preserve it
                localPlayerId: state === null ? null : currentState.localPlayerId,
            }));
        },

        _setLocalPlayerId(playerId: PlayerId | null): void {
            set(() => ({
                localPlayerId: playerId,
            }));
        },

        _setLocalSeatIds(playerIds: readonly PlayerId[]): void {
            set(() => ({
                localSeatIds: [...playerIds],
            }));
        },

        async updateLobbyPlayerReadyState(ready: boolean): Promise<void> {
            const api =
                bridge ??
                (
                    globalThis as {
                        __chimera?: {
                            lobby: { updatePlayerReadyState(ready: boolean): Promise<void> };
                        };
                    }
                ).__chimera;
            if (!api?.lobby) {
                throw new Error(
                    '[lobbyStore] preload bridge unavailable — window.__chimera.lobby is not set',
                );
            }
            await api.lobby.updatePlayerReadyState(ready);

            // Update the lobby state in the store after the API call
            set((state) => {
                if (state.lobbyState === null) {
                    return state;
                }

                const updatedPlayers = state.lobbyState.players.map((player) =>
                    player.playerId === state.lobbyState?.players[0]?.playerId
                        ? { ...player, ready }
                        : player,
                );

                return {
                    lobbyState: {
                        ...state.lobbyState,
                        players: updatedPlayers,
                    },
                };
            });
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
