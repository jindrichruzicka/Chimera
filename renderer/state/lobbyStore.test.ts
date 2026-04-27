/**
 * renderer/state/lobbyStore.test.ts
 *
 * Unit tests for the lobby store implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createLobbyStore, useLobbyStore } from './lobbyStore';
import type { LobbyState } from '@chimera/shared/messages-schemas.js';

describe('lobbyStore', () => {
    beforeEach(() => {
        // Reset the store before each test
        useLobbyStore.getState().applyLobbyState(null);
    });

    it('should initialize with null lobby state', () => {
        const store = createLobbyStore();
        const state = store.getState();
        expect(state.lobbyState).toBeNull();
    });

    it('should apply lobby state correctly', () => {
        const store = createLobbyStore();
        const mockLobbyState: LobbyState = {
            info: {
                sessionId: 'test-session',
                hostId: 'host-123',
                gameId: 'tactics',
            },
            players: [
                {
                    playerId: 'player-1',
                    displayName: 'Player 1',
                    ready: false,
                },
            ],
        };

        store.getState().applyLobbyState(mockLobbyState);
        const state = store.getState();
        expect(state.lobbyState).toEqual(mockLobbyState);
    });

    it('should handle null lobby state correctly', () => {
        const store = createLobbyStore();
        const mockLobbyState: LobbyState = {
            info: {
                sessionId: 'test-session',
                hostId: 'host-123',
                gameId: 'tactics',
            },
            players: [
                {
                    playerId: 'player-1',
                    displayName: 'Player 1',
                    ready: false,
                },
            ],
        };

        store.getState().applyLobbyState(mockLobbyState);
        store.getState().applyLobbyState(null);
        const state = store.getState();
        expect(state.lobbyState).toBeNull();
    });

    it('replaces prior lobby state with the latest IPC mirror payload', () => {
        const store = createLobbyStore();
        const firstState: LobbyState = {
            info: {
                sessionId: 'session-a',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'One', ready: false }],
        };
        const secondState: LobbyState = {
            info: {
                sessionId: 'session-a',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'One', ready: true }],
        };

        store.getState().applyLobbyState(firstState);
        store.getState().applyLobbyState(secondState);

        expect(store.getState().lobbyState).toEqual(secondState);
    });
});
