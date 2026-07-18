/**
 * electron/main/dev/DevHarnessCoordinator.test.ts
 *
 * Unit tests for the dev-harness auto-flow. The lobby is a recording
 * structural fake ({@link DevHarnessLobbyPort}) — no IPC, no network, no FS;
 * scenario loading and announce writing are injected function doubles.
 */

import { describe, expect, it, vi } from 'vitest';

import type { LobbyState, PlayerId } from '@chimera-engine/networking';
import { playerId } from '@chimera-engine/networking';
import {
    DevScenarioSchema,
    type DevAnnounce,
    type DevScenario,
} from '@chimera-engine/simulation/foundation/dev-fixture-contract.js';

import { createNoopLogger } from '../logging/logger.js';
import {
    DevHarnessCoordinator,
    type DevHarnessCoordinatorOptions,
    type DevHarnessFlagsView,
    type DevHarnessLobbyPort,
} from './DevHarnessCoordinator.js';

const HOST_ID = playerId('host-1');

function makeFlags(overrides: Partial<DevHarnessFlagsView> = {}): DevHarnessFlagsView {
    return {
        autoHost: false,
        autoJoin: undefined,
        scenarioFile: undefined,
        seat: undefined,
        players: undefined,
        announceFile: undefined,
        game: undefined,
        ...overrides,
    };
}

function makeLobby(localId: PlayerId = HOST_ID): DevHarnessLobbyPort & {
    readonly calls: string[];
    startGame: ReturnType<typeof vi.fn>;
} {
    const calls: string[] = [];
    return {
        calls,
        hostLobby(params: { gameId: string; maxPlayers: number }) {
            calls.push(`hostLobby:${params.gameId}:${params.maxPlayers}`);
            return Promise.resolve({ sessionId: '127.0.0.1:52110:tok3n', hostId: HOST_ID });
        },
        joinLobby(params: { address: string }) {
            calls.push(`joinLobby:${params.address}`);
            return Promise.resolve({ sessionId: params.address, hostId: HOST_ID });
        },
        setMatchSetting(key: string, value: string) {
            calls.push(`setMatchSetting:${key}=${value}`);
            return Promise.resolve();
        },
        setPlayerAttribute(id: PlayerId, key: string, value: string) {
            calls.push(`setPlayerAttribute:${id}:${key}=${value}`);
            return Promise.resolve();
        },
        updatePlayerReadyState(ready: boolean) {
            calls.push(`ready:${ready}`);
            return Promise.resolve();
        },
        addAi() {
            calls.push('addAi');
            return Promise.resolve();
        },
        startGame: vi.fn(() => {
            calls.push('startGame');
            return Promise.resolve();
        }),
        getLocalPlayerId() {
            return localId;
        },
    };
}

function scenarioOf(raw: unknown): DevScenario {
    return DevScenarioSchema.parse(raw);
}

function makeCoordinator(overrides: Partial<DevHarnessCoordinatorOptions> = {}): {
    coordinator: DevHarnessCoordinator;
    lobby: ReturnType<typeof makeLobby>;
    announces: DevAnnounce[];
} {
    const lobby =
        overrides.lobby !== undefined
            ? (overrides.lobby as ReturnType<typeof makeLobby>)
            : makeLobby();
    const announces: DevAnnounce[] = [];
    const coordinator = new DevHarnessCoordinator({
        flags: makeFlags(),
        hostedGameId: 'sample',
        fallbackMaxPlayers: 2,
        lobby,
        attestation: () => ({ playerId: 'attested', displayName: 'Attested' }),
        loadScenario: () => Promise.reject(new Error('no scenario expected in this test')),
        writeAnnounce: (path: string, announce: DevAnnounce) => {
            lobby.calls.push(`announce:${path}:${announce.lobbyCode}`);
            announces.push(announce);
            return Promise.resolve();
        },
        logger: createNoopLogger(),
        ...overrides,
    });
    return { coordinator, lobby, announces };
}

/** A lobby state with `count` seated players, all ready by default. */
function stateWith(count: number, opts: { ready?: boolean; agentSlots?: number } = {}): LobbyState {
    const players = Array.from({ length: count }, (_, i) => ({
        playerId: i === 0 ? HOST_ID : playerId(`p-${i + 1}`),
        displayName: `P${i + 1}`,
        ready: opts.ready ?? true,
    }));
    return {
        info: { sessionId: 's', hostId: HOST_ID, gameId: 'sample' },
        players,
        ...(opts.agentSlots !== undefined && opts.agentSlots > 0
            ? {
                  agentSlots: Array.from({ length: opts.agentSlots }, (_, i) => ({
                      slotIndex: count + i,
                      difficulty: 'standard',
                  })),
              }
            : {}),
    } as unknown as LobbyState;
}

const SCENARIO = {
    gameId: 'sample',
    seats: [
        { profile: 'alice.json', attributes: { deck: '["strike"]' } },
        { profile: 'bob.json', attributes: { deck: '["fang"]' } },
    ],
    aiSeats: 1,
    matchSettings: { arena: 'lava-pit', turnMode: 'commitment' },
};

describe('DevHarnessCoordinator — host bootstrap', () => {
    it('runs the full seeding sequence in order and announces only after seeding', async () => {
        const { coordinator, lobby } = makeCoordinator({
            flags: makeFlags({
                autoHost: true,
                scenarioFile: '/app/dev/scenarios/skirmish.json',
                seat: 1,
                announceFile: '/ud/p1/announce.json',
            }),
            loadScenario: () => Promise.resolve(scenarioOf(SCENARIO)),
        });

        await coordinator.bootstrap();

        expect(lobby.calls).toEqual([
            'hostLobby:sample:3', // 2 human seats + 1 AI seat
            'setMatchSetting:arena=lava-pit',
            'setMatchSetting:turnMode=commitment',
            `setPlayerAttribute:${HOST_ID}:deck=["strike"]`,
            'addAi',
            'announce:/ud/p1/announce.json:127.0.0.1:52110:tok3n',
            'ready:true',
        ]);
    });

    it('hosts with --dev-players when no scenario is given, and still announces + readies', async () => {
        const { coordinator, lobby, announces } = makeCoordinator({
            flags: makeFlags({ autoHost: true, players: 3, announceFile: '/ud/p1/a.json' }),
        });

        await coordinator.bootstrap();

        expect(lobby.calls).toEqual([
            'hostLobby:sample:3',
            'announce:/ud/p1/a.json:127.0.0.1:52110:tok3n',
            'ready:true',
        ]);
        expect(announces[0]?.gameId).toBe('sample');
    });

    it('falls back to fallbackMaxPlayers with neither scenario nor --dev-players', async () => {
        const { coordinator, lobby } = makeCoordinator({
            flags: makeFlags({ autoHost: true }),
        });

        await coordinator.bootstrap();

        expect(lobby.calls[0]).toBe('hostLobby:sample:2');
    });

    it('refuses a scenario whose gameId differs from the hosted game — before hosting anything', async () => {
        const { coordinator, lobby } = makeCoordinator({
            flags: makeFlags({ autoHost: true, scenarioFile: '/s.json' }),
            loadScenario: () => Promise.resolve(scenarioOf({ ...SCENARIO, gameId: 'other-game' })),
        });

        await expect(coordinator.bootstrap()).rejects.toThrow(/other-game/);
        expect(lobby.calls).toEqual([]);
    });

    it('refuses a --dev-game that differs from the hosted game', async () => {
        const { coordinator, lobby } = makeCoordinator({
            flags: makeFlags({ autoHost: true, game: 'other-game' }),
        });

        await expect(coordinator.bootstrap()).rejects.toThrow(/other-game/);
        expect(lobby.calls).toEqual([]);
    });

    it('skips the ready call when the host seat declares ready:false (manual-iteration workflow)', async () => {
        const { coordinator, lobby } = makeCoordinator({
            flags: makeFlags({ autoHost: true, scenarioFile: '/s.json', seat: 1 }),
            loadScenario: () => Promise.resolve(scenarioOf({ seats: [{ ready: false }, {}] })),
        });

        await coordinator.bootstrap();

        expect(lobby.calls).toEqual(['hostLobby:sample:2']);
    });
});

describe('DevHarnessCoordinator — client bootstrap', () => {
    it('joins with the relayed lobby code and the profile attestation, applies its seat, readies', async () => {
        const { coordinator, lobby } = makeCoordinator({
            flags: makeFlags({
                autoJoin: '127.0.0.1:52110:tok3n',
                scenarioFile: '/s.json',
                seat: 2,
            }),
            loadScenario: () => Promise.resolve(scenarioOf(SCENARIO)),
        });

        await coordinator.bootstrap();

        expect(lobby.calls).toEqual([
            'joinLobby:127.0.0.1:52110:tok3n',
            `setPlayerAttribute:${HOST_ID}:deck=["fang"]`,
            'ready:true',
        ]);
    });

    it('propagates a join rejection so the instance exits and the harness tears down', async () => {
        const lobby = makeLobby();
        lobby.joinLobby = () => Promise.reject(new Error('profile:NAMESPACE_COLLISION'));
        const { coordinator } = makeCoordinator({
            flags: makeFlags({ autoJoin: '127.0.0.1:52110:tok3n' }),
            lobby,
        });

        await expect(coordinator.bootstrap()).rejects.toThrow(/NAMESPACE_COLLISION/);
    });

    it('fails loudly instead of silently dropping seat attributes when no local id is available', async () => {
        const lobby = makeLobby();
        lobby.getLocalPlayerId = () => null;
        const { coordinator } = makeCoordinator({
            flags: makeFlags({
                autoJoin: '127.0.0.1:52110:tok3n',
                scenarioFile: '/s.json',
                seat: 2,
            }),
            lobby,
            loadScenario: () => Promise.resolve(scenarioOf(SCENARIO)),
        });

        await expect(coordinator.bootstrap()).rejects.toThrow(/local player id/i);
    });

    it('does nothing at all when neither auto flag is set', async () => {
        const { coordinator, lobby } = makeCoordinator({ flags: makeFlags() });

        await coordinator.bootstrap();

        expect(lobby.calls).toEqual([]);
    });
});

describe('DevHarnessCoordinator — auto-start latch', () => {
    async function bootstrappedHost(
        overrides: Partial<DevHarnessCoordinatorOptions> = {},
    ): Promise<{ coordinator: DevHarnessCoordinator; lobby: ReturnType<typeof makeLobby> }> {
        const { coordinator, lobby } = makeCoordinator({
            flags: makeFlags({ autoHost: true, scenarioFile: '/s.json', seat: 1 }),
            loadScenario: () => Promise.resolve(scenarioOf(SCENARIO)),
            ...overrides,
        });
        await coordinator.bootstrap();
        lobby.calls.length = 0;
        return { coordinator, lobby };
    }

    it('starts exactly once when the roster is complete, every player is ready, and AI slots match', async () => {
        const { coordinator, lobby } = await bootstrappedHost();

        coordinator.onLobbyStateChanged(stateWith(1, { agentSlots: 1 })); // roster incomplete
        coordinator.onLobbyStateChanged(stateWith(2, { ready: false, agentSlots: 1 })); // not ready
        coordinator.onLobbyStateChanged(stateWith(2, { agentSlots: 0 })); // AI missing
        expect(lobby.startGame).not.toHaveBeenCalled();

        coordinator.onLobbyStateChanged(stateWith(2, { agentSlots: 1 })); // complete
        coordinator.onLobbyStateChanged(stateWith(2, { agentSlots: 1 })); // duplicate push
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(lobby.startGame).toHaveBeenCalledTimes(1);
    });

    it('never starts when the scenario opts out (autoStart:false)', async () => {
        const { coordinator, lobby } = await bootstrappedHost({
            loadScenario: () => Promise.resolve(scenarioOf({ ...SCENARIO, autoStart: false })),
        });

        coordinator.onLobbyStateChanged(stateWith(2, { agentSlots: 1 }));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(lobby.startGame).not.toHaveBeenCalled();
    });

    it('never starts from a joined (client) instance — the host is the sole starter', async () => {
        const { coordinator, lobby } = makeCoordinator({
            flags: makeFlags({
                autoJoin: '127.0.0.1:52110:tok3n',
                seat: 2,
                scenarioFile: '/s.json',
            }),
            loadScenario: () => Promise.resolve(scenarioOf(SCENARIO)),
        });
        await coordinator.bootstrap();

        coordinator.onLobbyStateChanged(stateWith(2, { agentSlots: 1 }));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(lobby.startGame).not.toHaveBeenCalled();
    });

    it('uses --dev-players as the expected roster for a scenario-less auto-start', async () => {
        const { coordinator, lobby } = makeCoordinator({
            flags: makeFlags({ autoHost: true, players: 3 }),
        });
        await coordinator.bootstrap();

        coordinator.onLobbyStateChanged(stateWith(2));
        expect(lobby.startGame).not.toHaveBeenCalled();

        coordinator.onLobbyStateChanged(stateWith(3));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(lobby.startGame).toHaveBeenCalledTimes(1);
    });

    it('retries on a later push when startGame fails (transient un-ready race)', async () => {
        const { coordinator, lobby } = await bootstrappedHost();
        lobby.startGame.mockImplementationOnce(() =>
            Promise.reject(new Error('not all players ready')),
        );

        coordinator.onLobbyStateChanged(stateWith(2, { agentSlots: 1 }));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(lobby.startGame).toHaveBeenCalledTimes(1);

        coordinator.onLobbyStateChanged(stateWith(2, { agentSlots: 1 }));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(lobby.startGame).toHaveBeenCalledTimes(2);
    });

    it('re-arms itself after a failure even when no further push ever arrives (stable roster)', async () => {
        const { coordinator, lobby } = await bootstrappedHost({ startRetryDelayMs: 5 });
        lobby.startGame.mockImplementationOnce(() =>
            Promise.reject(new Error('transient session error')),
        );

        // The roster is already complete when the failing start fires; without a
        // self-scheduled retry no state delta would ever re-trigger the latch.
        coordinator.onLobbyStateChanged(stateWith(2, { agentSlots: 1 }));
        await new Promise<void>((resolve) => setTimeout(resolve, 50));

        expect(lobby.startGame).toHaveBeenCalledTimes(2);
    });
});
