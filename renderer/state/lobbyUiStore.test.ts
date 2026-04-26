/**
 * renderer/state/lobbyUiStore.test.ts
 *
 * Unit tests for local-only lobby UI metadata store.
 */

import { describe, expect, it } from 'vitest';
import { createLobbyUiStore } from './lobbyUiStore';

describe('lobbyUiStore', () => {
    it('initializes with null local player id and empty seat ids', () => {
        const store = createLobbyUiStore();

        expect(store.getState().localPlayerId).toBeNull();
        expect(store.getState().localSeatIds).toEqual([]);
    });

    it('sets and clears local lobby context', () => {
        const store = createLobbyUiStore();

        store.getState().setLocalLobbyContext('p1', ['p1', 'p1-local-seat-2']);
        expect(store.getState().localPlayerId).toBe('p1');
        expect(store.getState().localSeatIds).toEqual(['p1', 'p1-local-seat-2']);

        store.getState().clearLocalLobbyContext();
        expect(store.getState().localPlayerId).toBeNull();
        expect(store.getState().localSeatIds).toEqual([]);
    });
});
