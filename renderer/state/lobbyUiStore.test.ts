/**
 * renderer/state/lobbyUiStore.test.ts
 *
 * Unit tests for local-only lobby UI metadata store.
 */

import { describe, expect, it } from 'vitest';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { createLobbyUiStore } from './lobbyUiStore';

describe('lobbyUiStore', () => {
    it('initializes with null local player id and empty seat ids', () => {
        const store = createLobbyUiStore();

        expect(store.getState().localPlayerId).toBeNull();
        expect(store.getState().localSeatIds).toEqual([]);
    });

    it('sets and clears local lobby context', () => {
        const store = createLobbyUiStore();

        store.getState().setLocalLobbyContext(playerId('p1'), [playerId('p1'), playerId('p2')]);
        expect(store.getState().localPlayerId).toBe(playerId('p1'));
        expect(store.getState().localSeatIds).toEqual([playerId('p1'), playerId('p2')]);

        store.getState().clearLocalLobbyContext();
        expect(store.getState().localPlayerId).toBeNull();
        expect(store.getState().localSeatIds).toEqual([]);
    });

    it('initializes with the leaving-to-main-menu intent flag cleared', () => {
        const store = createLobbyUiStore();

        expect(store.getState().leavingToMainMenu).toBe(false);
    });

    it('sets and resets the leaving-to-main-menu intent flag', () => {
        const store = createLobbyUiStore();

        store.getState().setLeavingToMainMenu(true);
        expect(store.getState().leavingToMainMenu).toBe(true);

        store.getState().setLeavingToMainMenu(false);
        expect(store.getState().leavingToMainMenu).toBe(false);
    });
});
