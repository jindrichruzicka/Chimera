/**
 * electron/main/lobby/lobbySetupRegistry.test.ts
 *
 * Unit tests for the main-side lobby-setup registry and its pure helpers.
 *
 * Architecture: §4.14 — LobbyManager; §4.4 — Lobby State Sync
 * Task: #706 (part of #702 — Customizable Lobby)
 */

import { describe, it, expect } from 'vitest';
import { playerId, type LobbyState } from '@chimera-engine/networking';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';
import type { GameLobbySetup } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import type { QuickStartConfig } from '@chimera-engine/simulation/foundation/quick-start-contract.js';
import { createSyntheticAIPlayerId } from '../runtime/syntheticAgentId.js';
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
// `MainGameContribution.lobbySetup`, derived by the host into this map.
const SAMPLE_SETUP: GameLobbySetup = {
    maxPlayers: 4,
    gameParamDefaults: {},
    gameParamOptions: {},
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

// The quick-start contract is a `simulation/foundation` leaf, so `electron/`
// reaches it on the same contract path it already uses for `GameLobbySetup` —
// no new module-boundary exception. The renderer half of this guard lives in
// `renderer/__tests__/quick-start-contract-boundary.test.ts`.
describe('QuickStartConfig from electron/', () => {
    it('type-checks and carries every seat kind on a resolved GameLobbySetup', () => {
        const quickStart: QuickStartConfig = {
            gameParams: { mapSize: 'small' },
            hostAttributes: { team: 'red' },
            localSeats: [{ attributes: { team: 'blue' } }],
            aiSeats: [{ attributes: { team: 'green' }, omniscient: true }],
        };
        const resolve = createResolveLobbySetup(() => SAMPLE_CONTENT, {
            sample: (): GameLobbySetup => ({ ...SAMPLE_SETUP, quickStart }),
        });

        expect(resolve('sample')?.quickStart).toBe(quickStart);
    });
});

describe('buildSetupFromLobbyState', () => {
    it('returns undefined when there are no game params and no player attributes', () => {
        expect(buildSetupFromLobbyState(makeState())).toBeUndefined();
    });

    it('returns undefined when gameParams is an empty object and no attributes exist', () => {
        expect(buildSetupFromLobbyState(makeState({ gameParams: {} }))).toBeUndefined();
    });

    it('builds a full config with empty playerAttributes when only gameParams exist', () => {
        const result = buildSetupFromLobbyState(makeState({ gameParams: { mapSize: 'small' } }));
        expect(result).toEqual({ gameParams: { mapSize: 'small' }, playerAttributes: {} });
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
            gameParams: {},
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
        // The synced commitment battle-mode flag rides gameParams verbatim into
        // engine:start_game → snapshot.setup so T8 can read it via readTacticsTurnMode.
        const result = buildSetupFromLobbyState(
            makeState({ gameParams: { turnMode: 'commitment' } }),
        );
        expect(result?.gameParams['turnMode']).toBe('commitment');
    });

    it('keys an AI agent slot\'s attributes by its synthetic "ai-<slotIndex>" player id', () => {
        const state = makeState({
            agentSlots: [{ slotIndex: 1, kind: 'ai', attributes: { character: 'rogue' } }],
        });
        expect(buildSetupFromLobbyState(state)).toEqual({
            gameParams: {},
            playerAttributes: { 'ai-1': { character: 'rogue' } },
        });
    });

    it('uses the same synthetic id the host seats the AI under at game start', () => {
        // The key above is only useful if it matches the id
        // `collectGameStartAiPlayerSlots` registers — otherwise `snapshot.setup`
        // would describe a seat that never exists.
        expect(createSyntheticAIPlayerId(1)).toBe('ai-1');
    });

    it('builds a config when an AI slot carries the only attributes in the lobby', () => {
        // Before this widening the roster walk saw `players` only, so an
        // AI-only lobby returned `undefined` and the AI's picks never shipped.
        const state = makeState({
            agentSlots: [{ slotIndex: 2, kind: 'ai', attributes: { character: 'mage' } }],
        });
        expect(buildSetupFromLobbyState(state)).not.toBeUndefined();
    });

    it('omits AI slots with absent or empty attributes', () => {
        const state = makeState({
            agentSlots: [
                { slotIndex: 1, kind: 'ai' },
                { slotIndex: 2, kind: 'ai', attributes: {} },
                { slotIndex: 3, kind: 'ai', attributes: { character: 'rogue' } },
            ],
        });
        expect(buildSetupFromLobbyState(state)).toEqual({
            gameParams: {},
            playerAttributes: { 'ai-3': { character: 'rogue' } },
        });
    });

    it('returns undefined when the only agent slots carry no attributes', () => {
        const state = makeState({ agentSlots: [{ slotIndex: 1, kind: 'ai' }] });
        expect(buildSetupFromLobbyState(state)).toBeUndefined();
    });

    it('ignores a human-kind agent slot — no synthetic seat is ever created for one', () => {
        // Only `kind: 'ai'` slots become `ai-<slotIndex>` seats; a human-kind
        // slot is a placeholder for a joining human whose own `players` entry
        // carries its attributes.
        const state = makeState({
            agentSlots: [{ slotIndex: 1, kind: 'human', attributes: { character: 'rogue' } }],
        });
        expect(buildSetupFromLobbyState(state)).toBeUndefined();
    });

    it('lets a real seat entry win over an agent slot claiming the same id', () => {
        const state = makeState({
            players: [
                {
                    playerId: playerId('ai-1'),
                    displayName: 'ai-1',
                    ready: false,
                    attributes: { character: 'seat' },
                },
            ],
            agentSlots: [{ slotIndex: 1, kind: 'ai', attributes: { character: 'slot' } }],
        });
        expect(buildSetupFromLobbyState(state)?.playerAttributes['ai-1']).toEqual({
            character: 'seat',
        });
    });

    it("carries a local (pass-and-play) seat's attributes beside the host's", () => {
        // A local seat is a real `players` entry (LobbyManager.addLocalSeat
        // seeds it from the descriptor), so it travels the same road as a
        // remote human's seat.
        const state = makeState({
            players: [
                {
                    playerId: playerId('host'),
                    displayName: 'host',
                    ready: true,
                    attributes: { team: 'red' },
                },
                {
                    playerId: playerId('host-local-2'),
                    displayName: 'Player 2',
                    ready: true,
                    attributes: { team: 'blue' },
                },
            ],
        });
        expect(buildSetupFromLobbyState(state)?.playerAttributes).toEqual({
            host: { team: 'red' },
            'host-local-2': { team: 'blue' },
        });
    });

    it('carries host, local, AI seats and game params into one config', () => {
        const state = makeState({
            gameParams: { mapSize: 'large' },
            players: [
                {
                    playerId: playerId('host'),
                    displayName: 'host',
                    ready: true,
                    attributes: { team: 'red' },
                },
                {
                    playerId: playerId('host-local-2'),
                    displayName: 'Player 2',
                    ready: true,
                    attributes: { team: 'blue' },
                },
            ],
            agentSlots: [{ slotIndex: 2, kind: 'ai', attributes: { team: 'green' } }],
        });
        expect(buildSetupFromLobbyState(state)).toEqual({
            gameParams: { mapSize: 'large' },
            playerAttributes: {
                host: { team: 'red' },
                'host-local-2': { team: 'blue' },
                'ai-2': { team: 'green' },
            },
        });
    });

    it('shares no object with the lobby state it was built from', () => {
        // The config is carried onto the snapshot and projected, so a later
        // lobby edit must not be able to reach into a started match's `setup`.
        const hostAttributes = { team: 'red' };
        const slotAttributes = { team: 'green' };
        const gameParams = { mapSize: 'large' };
        const state = makeState({
            gameParams,
            players: [
                {
                    playerId: playerId('host'),
                    displayName: 'host',
                    ready: true,
                    attributes: hostAttributes,
                },
            ],
            agentSlots: [{ slotIndex: 1, kind: 'ai', attributes: slotAttributes }],
        });

        const result = buildSetupFromLobbyState(state);

        expect(result?.gameParams).toEqual(gameParams);
        expect(result?.gameParams).not.toBe(gameParams);
        expect(result?.playerAttributes['host']).toEqual(hostAttributes);
        expect(result?.playerAttributes['host']).not.toBe(hostAttributes);
        expect(result?.playerAttributes['ai-1']).toEqual(slotAttributes);
        expect(result?.playerAttributes['ai-1']).not.toBe(slotAttributes);
    });

    it('combines gameParams and per-player attributes into one config', () => {
        const state = makeState({
            gameParams: { mapSize: 'large' },
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
            gameParams: { mapSize: 'large' },
            playerAttributes: { host: { team: 'red' } },
        });
    });
});
