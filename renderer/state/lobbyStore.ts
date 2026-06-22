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
import type { LobbyState } from '@chimera/simulation/foundation/messages-schemas.js';

// ── Store shape ───────────────────────────────────────────────────────────────

export interface LobbyStoreState {
    /** Current lobby state, or null if not in a lobby. */
    readonly lobbyState: LobbyState | null;

    /** True once the bootstrap has replayed the main process' current lobby state. */
    readonly hasLoadedInitialState: boolean;

    /**
     * Apply incoming lobby state from IPC (chimera:lobby-update push).
     * ipcClient only — do NOT call from components directly.
     */
    applyLobbyState(state: LobbyState | null): void;

    /** Mark that the initial main-process lobby-state replay is in progress. */
    markInitialStateLoading(): void;

    /** Mark that the initial main-process lobby-state replay has completed. */
    markInitialStateLoaded(): void;
}

// ── Factory (for testing and production use) ──────────────────────────────────

/**
 * Create an isolated store instance.
 */
export function createLobbyStore(): StoreApi<LobbyStoreState> {
    return createStore<LobbyStoreState>()((set) => ({
        lobbyState: null,
        hasLoadedInitialState: false,

        applyLobbyState(state: LobbyState | null): void {
            set(() => ({
                lobbyState: state,
            }));
        },

        markInitialStateLoading(): void {
            set(() => ({ hasLoadedInitialState: false }));
        },

        markInitialStateLoaded(): void {
            set(() => ({ hasLoadedInitialState: true }));
        },
    }));
}

// ── Singleton store (lazy) ──────────────────────────────────────────────────────

let lobbyStoreInstance: StoreApi<LobbyStoreState> | undefined;

/**
 * Lazily instantiate the singleton on first access. Importing this module — and
 * the `@chimera/renderer/components/chat` barrel that pulls it through
 * `ChatPanel` — therefore creates no store, keeping that barrel side-effect-free
 * (issue #772, Invariant #96). Behaviour is otherwise identical to an eager
 * module-level singleton: the same instance is returned on every access.
 */
function getLobbyStore(): StoreApi<LobbyStoreState> {
    return (lobbyStoreInstance ??= createLobbyStore());
}

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
    return useStore(getLobbyStore(), selector);
}

// Expose static accessors for direct store access (IPC wiring, tests)
useLobbyStore.getState = (): LobbyStoreState => getLobbyStore().getState();
useLobbyStore.subscribe = ((
    listener: Parameters<StoreApi<LobbyStoreState>['subscribe']>[0],
): (() => void) => getLobbyStore().subscribe(listener)) as StoreApi<LobbyStoreState>['subscribe'];
