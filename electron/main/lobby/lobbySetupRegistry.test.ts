/**
 * electron/main/lobby/lobbySetupRegistry.test.ts
 *
 * Unit tests for the main-side lobby-setup registry and its pure helpers.
 *
 * Architecture: §4.14 — LobbyManager; §4.4 — Lobby State Sync
 * Task: #706 (part of #702 — Customizable Lobby)
 */

import { describe, it, expect } from 'vitest';
import { playerId, type LobbyState } from '@chimera/networking';
import type { GameContent } from '@chimera/simulation/foundation/game-content-contract.js';
import type { GameLobbySetup } from '@chimera/simulation/foundation/game-lobby-contract.js';
import { createResolveLobbySetup, buildSetupFromLobbyState } from './lobbySetupRegistry.js';

const SAMPLE_CONTENT: GameContent = {
    'player-colors': [
        { id: 'blue', name: 'Blue', hex: '#2563eb' },
        { id: 'red', name: 'Red', hex: '#dc2626' },
    ],
    'board-colors': [{ id: 'slate', name: 'Slate', hex: '#3f3f46' }],
};

// A generic descriptor + injected builder map. The package names no game: the
// concrete builder arrives from the consumer composition root via
// `MainGameContribution.lobbySetup`, derived by the host into this map (#789).
const SAMPLE_SETUP: GameLobbySetup = {
    maxPlayers: 4,
    matchSettingsDefaults: {},
    matchSettingsOptions: {},
    playerAttributeOptions: {},
    resolveDefaultPlayerAttributes: () => ({}),
};
const sampleBuilders: Readonly<Record<string, (content: GameContent) => GameLobbySetup>> = {
    sample: () => SAMPLE_SETUP,
};

function makeState(overrides: Partial<LobbyState> = {}): LobbyState {
    return {
        info: { sessionId: 'sess-1', hostId: playerId('host'), gameId: 'tactics' },
        players: [{ playerId: playerId('host'), displayName: 'host', ready: false }],
        ...overrides,
    };
}

describe('createResolveLobbySetup', () => {
    it('resolves a game descriptor by gameId from the injected builder map when content is available', () => {
        const resolve = createResolveLobbySetup(() => SAMPLE_CONTENT, sampleBuilders);
        expect(resolve('sample')).toBe(SAMPLE_SETUP);
    });

    it('returns undefined for a gameId with no injected builder', () => {
        const resolve = createResolveLobbySetup(() => SAMPLE_CONTENT, sampleBuilders);
        expect(resolve('unknown')).toBeUndefined();
    });

    it('returns undefined when the game has no loaded content', () => {
        const resolve = createResolveLobbySetup(() => undefined, sampleBuilders);
        expect(resolve('sample')).toBeUndefined();
    });

    it('passes the loaded content into the injected builder', () => {
        let received: GameContent | undefined;
        const resolve = createResolveLobbySetup(() => SAMPLE_CONTENT, {
            sample: (content) => {
                received = content;
                return SAMPLE_SETUP;
            },
        });
        resolve('sample');
        expect(received).toBe(SAMPLE_CONTENT);
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

    it('carries the host-authored turn mode through to the match setup (T7 → T8)', () => {
        // The synced commitment battle-mode flag rides matchSettings verbatim into
        // engine:start_game → snapshot.setup so T8 can read it via readTacticsTurnMode.
        const result = buildSetupFromLobbyState(
            makeState({ matchSettings: { turnMode: 'commitment' } }),
        );
        expect(result?.matchSettings['turnMode']).toBe('commitment');
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
