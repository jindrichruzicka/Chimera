// @vitest-environment jsdom

/**
 * renderer/state/lobbyStoreBootstrap.test.ts
 *
 * Unit tests for lobbyStoreBootstrap.
 * Verifies that bootstrapLobbyStore registers the onUpdate and onConnectionStatus
 * callbacks and routes incoming push events into the lobbyStore singleton.
 *
 * Architecture reference: §F12/T02 (issue #269)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    LobbyAPI,
    SystemAPI,
    Unsubscribe,
    LobbyState,
} from '../../electron/preload/api-types';
import { bootstrapLobbyStore } from './lobbyStoreBootstrap';
import { useLobbyStore } from './lobbyStore';
import { useLobbyUiStore } from './lobbyUiStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeLobbyState = (): LobbyState => ({
    info: {
        sessionId: 'test-session',
        hostId: 'player-1',
        gameId: 'tactics',
    },
    players: [
        {
            playerId: 'player-1',
            displayName: 'Player One',
            ready: false,
        },
    ],
});

function makeLobbyApi(onUpdateImpl?: (cb: (lobby: LobbyState) => void) => Unsubscribe): LobbyAPI {
    return {
        host: vi.fn(),
        join: vi.fn(),
        getLocalPlayerId: vi.fn(),
        leave: vi.fn(),
        updatePlayerReadyState: vi.fn(),
        onUpdate: vi.fn(onUpdateImpl ?? (() => vi.fn())),
    };
}

function makeSystemApi(
    onConnectionStatusImpl?: (
        cb: (status: 'connected' | 'disconnected' | 'connecting' | 'error') => void,
    ) => Unsubscribe,
): SystemAPI {
    return {
        onConnectionStatus: vi.fn(onConnectionStatusImpl ?? (() => vi.fn())),
        platform: vi.fn(),
        quit: vi.fn(),
        relaunch: vi.fn(),
    };
}

// Reset the singleton store between tests
beforeEach(() => {
    useLobbyStore.setState({ lobbyState: null });
    useLobbyUiStore.getState().clearLocalLobbyContext();
});

// ── bootstrapLobbyStore ───────────────────────────────────────────────────────

describe('bootstrapLobbyStore()', () => {
    it('registers an onUpdate callback with the lobby API', () => {
        const lobbyApi = makeLobbyApi();
        const systemApi = makeSystemApi();
        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(lobbyApi.onUpdate).toHaveBeenCalledOnce();
    });

    it('registers an onConnectionStatus callback with the system API', () => {
        const lobbyApi = makeLobbyApi();
        const systemApi = makeSystemApi();
        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(systemApi.onConnectionStatus).toHaveBeenCalledOnce();
    });

    it('returns an Unsubscribe function', () => {
        const unsubscribeLobby = vi.fn();
        const unsubscribeSystem = vi.fn();
        const lobbyApi = makeLobbyApi(() => unsubscribeLobby);
        const systemApi = makeSystemApi(() => unsubscribeSystem);
        const result = bootstrapLobbyStore(lobbyApi, systemApi);
        expect(typeof result).toBe('function');
    });

    it('calling the returned unsubscribe invokes both API unsubscribes', () => {
        const unsubscribeLobby = vi.fn();
        const unsubscribeSystem = vi.fn();
        const lobbyApi = makeLobbyApi(() => unsubscribeLobby);
        const systemApi = makeSystemApi(() => unsubscribeSystem);
        const stop = bootstrapLobbyStore(lobbyApi, systemApi);
        stop();
        expect(unsubscribeLobby).toHaveBeenCalledOnce();
        expect(unsubscribeSystem).toHaveBeenCalledOnce();
    });

    it('routes onUpdate lobby state push event into the store via _applyLobbyState', () => {
        let capturedLobbyUpdate: ((lobby: LobbyState) => void) | undefined;
        const unsubLobby = vi.fn();
        const lobbyApi = makeLobbyApi((cb) => {
            capturedLobbyUpdate = cb;
            return unsubLobby;
        });
        const systemApi = makeSystemApi();

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedLobbyUpdate).toBeDefined();

        const incoming = makeLobbyState();
        capturedLobbyUpdate!(incoming);

        const stored = useLobbyStore.getState().lobbyState;
        expect(stored).toBe(incoming);
    });

    it('syncs localSeatIds from lobby players when local player identity is known', () => {
        let capturedLobbyUpdate: ((lobby: LobbyState) => void) | undefined;
        const lobbyApi = makeLobbyApi((cb) => {
            capturedLobbyUpdate = cb;
            return vi.fn();
        });
        const systemApi = makeSystemApi();

        useLobbyUiStore.getState().setLocalLobbyContext('player-1', ['player-1']);

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedLobbyUpdate).toBeDefined();

        capturedLobbyUpdate!({
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                {
                    playerId: 'player-1',
                    displayName: 'Player One',
                    ready: false,
                },
                {
                    playerId: 'player-2',
                    displayName: 'Player Two',
                    ready: false,
                },
            ],
        });

        expect(useLobbyUiStore.getState().localSeatIds).toEqual(['player-1', 'player-2']);
    });

    it('calls _applyLobbyState with null when connection status is disconnected', () => {
        let capturedConnectionStatus:
            | ((status: 'connected' | 'disconnected' | 'connecting' | 'error') => void)
            | undefined;
        const unsubSystem = vi.fn();
        const lobbyApi = makeLobbyApi();
        const systemApi = makeSystemApi((cb) => {
            capturedConnectionStatus = cb;
            return unsubSystem;
        });

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedConnectionStatus).toBeDefined();

        // Set some initial lobby state
        const initialState = makeLobbyState();
        useLobbyStore.getState()._applyLobbyState(initialState);
        useLobbyUiStore.getState().setLocalLobbyContext('player-1', ['player-1', 'player-2']);
        expect(useLobbyStore.getState().lobbyState).toBe(initialState);

        // Trigger disconnection
        capturedConnectionStatus!('disconnected');

        // Verify lobby state was cleared
        const stored = useLobbyStore.getState().lobbyState;
        expect(stored).toBeNull();
        expect(useLobbyUiStore.getState().localPlayerId).toBeNull();
        expect(useLobbyUiStore.getState().localSeatIds).toEqual([]);
    });
});
