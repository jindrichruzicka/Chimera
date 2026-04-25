/**
 * renderer/state/lobbyStore.test.ts
 *
 * Unit tests for the lobby store implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLobbyStore, useLobbyStore } from './lobbyStore';
import type { LobbyState, PlayerId } from '@chimera/shared/messages-schemas.js';

// Helper to create PlayerId strings for tests
const playerId = (id: string): PlayerId => id;

describe('lobbyStore', () => {
    beforeEach(() => {
        // Reset the store before each test
        useLobbyStore.setState({ lobbyState: null });
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
                hostId: playerId('host-123'),
                gameId: 'tactics',
            },
            players: [
                {
                    playerId: playerId('player-1'),
                    displayName: 'Player 1',
                    ready: false,
                },
            ],
        };

        store.getState()._applyLobbyState(mockLobbyState);
        const state = store.getState();
        expect(state.lobbyState).toEqual(mockLobbyState);
    });

    it('should handle null lobby state correctly', () => {
        const store = createLobbyStore();
        const mockLobbyState: LobbyState = {
            info: {
                sessionId: 'test-session',
                hostId: playerId('host-123'),
                gameId: 'tactics',
            },
            players: [
                {
                    playerId: playerId('player-1'),
                    displayName: 'Player 1',
                    ready: false,
                },
            ],
        };

        store.getState()._applyLobbyState(mockLobbyState);
        store.getState()._applyLobbyState(null);
        const state = store.getState();
        expect(state.lobbyState).toBeNull();
    });

    it('should update player ready state correctly with bridge', async () => {
        const mockBridge = {
            lobby: {
                updatePlayerReadyState: vi.fn().mockResolvedValue(undefined),
            },
        };

        const store = createLobbyStore(mockBridge);

        const mockLobbyState: LobbyState = {
            info: {
                sessionId: 'test-session',
                hostId: playerId('host-123'),
                gameId: 'tactics',
            },
            players: [
                {
                    playerId: playerId('player-1'),
                    displayName: 'Player 1',
                    ready: false,
                },
            ],
        };

        // Set initial lobby state
        store.getState()._applyLobbyState(mockLobbyState);

        // Update ready state
        await store.getState().updateLobbyPlayerReadyState(true);

        // Verify the bridge was called
        expect(mockBridge.lobby.updatePlayerReadyState).toHaveBeenCalledWith(true);

        // Verify the state was updated
        const state = store.getState();
        expect(state.lobbyState!.players[0]!.ready).toBe(true);
    });

    it('should throw error when bridge is not available', async () => {
        const store = createLobbyStore();

        const mockLobbyState: LobbyState = {
            info: {
                sessionId: 'test-session',
                hostId: playerId('host-123'),
                gameId: 'tactics',
            },
            players: [
                {
                    playerId: playerId('player-1'),
                    displayName: 'Player 1',
                    ready: false,
                },
            ],
        };

        // Set initial lobby state
        store.getState()._applyLobbyState(mockLobbyState);

        // Try to update ready state without bridge - should throw error
        await expect(store.getState().updateLobbyPlayerReadyState(true)).rejects.toThrow(
            '[lobbyStore] preload bridge unavailable — window.__chimera.lobby is not set',
        );
    });
});
