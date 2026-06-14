/**
 * electron/main/lobby/lobbySetupRegistry.test.ts
 *
 * Unit tests for the main-side lobby-setup registry and its pure helpers.
 *
 * Architecture: §4.14 — LobbyManager; §4.4 — Lobby State Sync
 * Task: #706 (part of #702 — Customizable Lobby)
 */

import { describe, it, expect } from 'vitest';
import { playerId, type LobbyState } from '@chimera/networking/provider/MultiplayerProvider.js';
import type { GameContent } from '@chimera/shared/game-content-contract.js';
import {
    lobbySetupBuilders,
    createResolveLobbySetup,
    buildSetupFromLobbyState,
} from './lobbySetupRegistry.js';

const TACTICS_CONTENT: GameContent = {
    'player-colors': [
        { id: 'blue', name: 'Blue', hex: '#2563eb' },
        { id: 'red', name: 'Red', hex: '#dc2626' },
    ],
    'board-colors': [{ id: 'slate', name: 'Slate', hex: '#3f3f46' }],
};

function makeState(overrides: Partial<LobbyState> = {}): LobbyState {
    return {
        info: { sessionId: 'sess-1', hostId: playerId('host'), gameId: 'tactics' },
        players: [{ playerId: playerId('host'), displayName: 'host', ready: false }],
        ...overrides,
    };
}

describe('lobbySetupBuilders', () => {
    it('builds the Tactics descriptor from transmitted content (#708)', () => {
        const setup = lobbySetupBuilders['tactics']?.(TACTICS_CONTENT);
        expect(setup?.maxPlayers).toBe(4);
        expect(setup?.playerAttributeOptions['color']).toEqual([
            { value: 'blue', label: 'Blue' },
            { value: 'red', label: 'Red' },
        ]);
        expect(setup?.matchSettingsOptions['boardColor']).toEqual([
            { value: 'slate', label: 'Slate' },
        ]);
    });
});

describe('createResolveLobbySetup', () => {
    it('resolves the Tactics descriptor by gameId when content is available', () => {
        const resolve = createResolveLobbySetup(() => TACTICS_CONTENT);
        expect(resolve('tactics')?.maxPlayers).toBe(4);
    });

    it('returns undefined for an unregistered gameId', () => {
        const resolve = createResolveLobbySetup(() => TACTICS_CONTENT);
        expect(resolve('unknown')).toBeUndefined();
    });

    it('returns undefined when the game has no loaded content', () => {
        const resolve = createResolveLobbySetup(() => undefined);
        expect(resolve('tactics')).toBeUndefined();
    });
});

describe('buildSetupFromLobbyState', () => {
    it('returns undefined when there are no match settings and no player attributes', () => {
        expect(buildSetupFromLobbyState(makeState())).toBeUndefined();
    });

    it('returns undefined when matchSettings is an empty object and no attributes exist', () => {
        expect(buildSetupFromLobbyState(makeState({ matchSettings: {} }))).toBeUndefined();
    });

    it('builds a full config with empty playerAttributes when only matchSettings exist', () => {
        const result = buildSetupFromLobbyState(makeState({ matchSettings: { mapSize: 'small' } }));
        expect(result).toEqual({ matchSettings: { mapSize: 'small' }, playerAttributes: {} });
    });

    it('keys playerAttributes by playerId and omits players without attributes', () => {
        const state = makeState({
            players: [
                {
                    playerId: playerId('host'),
                    displayName: 'host',
                    ready: true,
                    attributes: { team: 'red' },
                },
                { playerId: playerId('p2'), displayName: 'p2', ready: false },
                {
                    playerId: playerId('p3'),
                    displayName: 'p3',
                    ready: false,
                    attributes: { team: 'blue' },
                },
            ],
        });
        const result = buildSetupFromLobbyState(state);
        expect(result).toEqual({
            matchSettings: {},
            playerAttributes: { host: { team: 'red' }, p3: { team: 'blue' } },
        });
    });

    it('omits players whose attributes object is empty', () => {
        const state = makeState({
            players: [
                {
                    playerId: playerId('host'),
                    displayName: 'host',
                    ready: true,
                    attributes: {},
                },
            ],
        });
        expect(buildSetupFromLobbyState(state)).toBeUndefined();
    });

    it('combines matchSettings and per-player attributes into one config', () => {
        const state = makeState({
            matchSettings: { mapSize: 'large' },
            players: [
                {
                    playerId: playerId('host'),
                    displayName: 'host',
                    ready: true,
                    attributes: { team: 'red' },
                },
            ],
        });
        expect(buildSetupFromLobbyState(state)).toEqual({
            matchSettings: { mapSize: 'large' },
            playerAttributes: { host: { team: 'red' } },
        });
    });
});
