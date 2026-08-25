/**
 * electron/main/runtime/QuickStartCoordinator.test.ts
 *
 * Unit tests for the quick-start orchestrator: the guard set, the
 * defaults merge, the seat arithmetic, and the exact ordered sequence of
 * public `LobbyManager` verbs the coordinator drives. All collaborators are
 * vi.fn port stubs — no FS, network, or Electron IPC (repo unit-test rule).
 *
 * The "only public LobbyManager verbs" guarantee has two instruments. The
 * COMPILER pins that every verb the coordinator may drive exists on the public
 * manager with a compatible signature (`managerSatisfiesLobbyVerbs` below only
 * typechecks while that holds), so a port cannot quietly grow into a bespoke
 * session door. The ordered `calls` log below pins WHICH of them run, and in
 * what order, for a given config.
 *
 * Architecture reference: §4.14
 */

import { describe, expect, it, vi } from 'vitest';
import { playerId } from '@chimera-engine/simulation/engine/index.js';
import type { LobbyAgentSlot, LobbyInfo } from '@chimera-engine/networking';
import {
    SESSION_MODE_QUICK,
    SESSION_MODE_SETTING,
} from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import { createNoopLogger } from '../logging/logger.js';
import type { LobbyManager } from '../lobby/LobbyManager.js';
import {
    QuickStartCoordinator,
    QuickStartError,
    quickStartLocalSeatId,
    type QuickStartLobbyVerbs,
    type QuickStartPorts,
} from './QuickStartCoordinator.js';

/**
 * Compile-time pin for the acceptance criterion "only public `LobbyManager`
 * verbs are driven": the real manager must be assignable to the verb slice the
 * coordinator holds. Unused at runtime on purpose — `tsc` is the instrument.
 */
const managerSatisfiesLobbyVerbs: (manager: LobbyManager) => QuickStartLobbyVerbs = (manager) =>
    manager;

const GAME_ID = 'sample';
const HOST_ID = playerId('host-1');
const LOBBY_INFO: LobbyInfo = { sessionId: 'host:1234:token', hostId: HOST_ID, gameId: GAME_ID };

interface Harness {
    readonly coordinator: QuickStartCoordinator;
    readonly ports: QuickStartPorts;
    /** Ordered log of every port call, in the order the coordinator drove them. */
    readonly calls: string[];
    readonly hostedAgentSlots: () => readonly LobbyAgentSlot[];
}

function makeHarness(overrides: Partial<QuickStartPorts> = {}): Harness {
    const calls: string[] = [];
    let hostedAgentSlots: readonly LobbyAgentSlot[] = [];

    const base: QuickStartPorts = {
        hasActiveSession: () => false,
        isRestoreActive: () => false,
        resolveQuickStartDefaults: () => undefined,
        resolveSeatDefaultAttributes: () => ({}),
        hostLobby: (params) => {
            hostedAgentSlots = params.agentSlots;
            calls.push(`hostLobby:${params.gameId}:${String(params.maxPlayers)}`);
            return Promise.resolve(LOBBY_INFO);
        },
        setMatchSetting: (key, value) => {
            calls.push(`setMatchSetting:${key}=${value}`);
            return Promise.resolve();
        },
        setPlayerAttribute: (target, key, value) => {
            calls.push(`setPlayerAttribute:${String(target)}:${key}=${value}`);
            return Promise.resolve();
        },
        addLocalSeat: (seatId, options) => {
            calls.push(
                `addLocalSeat:${String(seatId)}:ready=${String(options.ready)}:` +
                    JSON.stringify(options.attributes ?? null),
            );
            return Promise.resolve();
        },
        updatePlayerReadyState: (ready) => {
            calls.push(`updatePlayerReadyState:${String(ready)}`);
            return Promise.resolve();
        },
        startGame: () => {
            calls.push('startGame');
            return Promise.resolve();
        },
        closeLobby: () => {
            calls.push('closeLobby');
            return Promise.resolve();
        },
    };

    const ports: QuickStartPorts = { ...base, ...overrides };
    return {
        coordinator: new QuickStartCoordinator({ ports, logger: createNoopLogger() }),
        ports,
        calls,
        hostedAgentSlots: () => hostedAgentSlots,
    };
}

describe('quickStartLocalSeatId', () => {
    it('mints a host-scoped id per pass-and-play seat, numbered by seat position', () => {
        // The host is seat 1, so the first extra local seat is "-local-2".
        expect(quickStartLocalSeatId(HOST_ID, 0)).toBe(playerId('host-1-local-2'));
        expect(quickStartLocalSeatId(HOST_ID, 1)).toBe(playerId('host-1-local-3'));
    });
});

describe('QuickStartCoordinator.quickStart — driven sequence', () => {
    it('drives the public lobby verbs in the documented order', async () => {
        const harness = makeHarness();

        await harness.coordinator.quickStart({
            gameId: GAME_ID,
            matchSettings: { mapSize: 'small' },
            hostAttributes: { team: 'red' },
            localSeats: [{ attributes: { team: 'blue' } }],
            aiSeats: [{ omniscient: true }],
        });

        expect(harness.calls).toEqual([
            // Roster is exactly full by design: host + 1 local + 1 AI.
            `hostLobby:${GAME_ID}:3`,
            // The engine stamp lands FIRST, before any game-authored setting.
            `setMatchSetting:${SESSION_MODE_SETTING}=${SESSION_MODE_QUICK}`,
            'setMatchSetting:mapSize=small',
            `setPlayerAttribute:${String(HOST_ID)}:team=red`,
            'addLocalSeat:host-1-local-2:ready=true:{"team":"blue"}',
            'updatePlayerReadyState:true',
            'startGame',
        ]);
    });

    it('pre-seeds the AI roster on the hostLobby call, never through addAi', async () => {
        const harness = makeHarness({
            resolveSeatDefaultAttributes: (_gameId, seatIndex) => ({
                team: `default-${String(seatIndex)}`,
            }),
        });

        await harness.coordinator.quickStart({
            gameId: GAME_ID,
            localSeats: [{}],
            aiSeats: [{ attributes: { colour: 'green' } }, { omniscient: true }],
        });

        // AI slots sit ABOVE the local seats so each local seat's roster
        // position equals its ledger slot index.
        expect(harness.hostedAgentSlots()).toEqual([
            { slotIndex: 2, kind: 'ai', attributes: { team: 'default-2', colour: 'green' } },
            { slotIndex: 3, kind: 'ai', omniscient: true, attributes: { team: 'default-3' } },
        ]);
    });

    it('leaves an AI slot attribute-less when neither the seat nor the game declares any', async () => {
        const harness = makeHarness();

        await harness.coordinator.quickStart({ gameId: GAME_ID, aiSeats: [{}] });

        // Not `attributes: {}` — an empty map would key the AI seat into
        // `snapshot.setup` where a lobby-added AI seat contributes nothing.
        expect(harness.hostedAgentSlots()).toEqual([{ slotIndex: 1, kind: 'ai' }]);
    });

    it('starts a solo match with an empty agent roster and maxPlayers 1', async () => {
        const harness = makeHarness();

        await harness.coordinator.quickStart({ gameId: GAME_ID });

        expect(harness.hostedAgentSlots()).toEqual([]);
        expect(harness.calls).toEqual([
            `hostLobby:${GAME_ID}:1`,
            `setMatchSetting:${SESSION_MODE_SETTING}=${SESSION_MODE_QUICK}`,
            'updatePlayerReadyState:true',
            'startGame',
        ]);
    });

    it('resolves to the hosted lobby info', async () => {
        const harness = makeHarness();

        await expect(harness.coordinator.quickStart({ gameId: GAME_ID })).resolves.toEqual(
            LOBBY_INFO,
        );
    });
});

describe('QuickStartCoordinator.quickStart — defaults merge', () => {
    it("merges the game's quickStart defaults UNDER the request, per key", async () => {
        const harness = makeHarness({
            resolveQuickStartDefaults: () => ({
                matchSettings: { mapSize: 'small', mode: 'skirmish' },
                hostAttributes: { team: 'red', banner: 'wolf' },
            }),
        });

        await harness.coordinator.quickStart({
            gameId: GAME_ID,
            matchSettings: { mapSize: 'large' },
            hostAttributes: { team: 'blue' },
        });

        // Sorted key order keeps the driven sequence deterministic.
        expect(harness.calls).toEqual([
            `hostLobby:${GAME_ID}:1`,
            `setMatchSetting:${SESSION_MODE_SETTING}=${SESSION_MODE_QUICK}`,
            'setMatchSetting:mapSize=large',
            'setMatchSetting:mode=skirmish',
            `setPlayerAttribute:${String(HOST_ID)}:banner=wolf`,
            `setPlayerAttribute:${String(HOST_ID)}:team=blue`,
            'updatePlayerReadyState:true',
            'startGame',
        ]);
    });

    it('replaces a default seat list wholesale when the request supplies one', async () => {
        const harness = makeHarness({
            resolveQuickStartDefaults: () => ({
                localSeats: [{}, {}],
                aiSeats: [{}, {}, {}],
            }),
        });

        await harness.coordinator.quickStart({ gameId: GAME_ID, aiSeats: [{}] });

        // Request aiSeats (1) replaces the default 3; localSeats fall back to
        // the default 2 — 1 host + 2 local + 1 AI.
        expect(harness.calls[0]).toBe(`hostLobby:${GAME_ID}:4`);
        expect(harness.hostedAgentSlots().map((slot) => slot.slotIndex)).toEqual([3]);
    });

    it('replaces a default LOCAL seat list wholesale when the request supplies one', async () => {
        const harness = makeHarness({
            resolveQuickStartDefaults: () => ({ localSeats: [{}, {}, {}] }),
        });

        await harness.coordinator.quickStart({ gameId: GAME_ID, localSeats: [{}] });

        // 1 host + the request's single local seat — never the declared three,
        // and never a positional merge of the two lists.
        expect(harness.calls[0]).toBe(`hostLobby:${GAME_ID}:2`);
        expect(harness.calls.filter((call) => call.startsWith('addLocalSeat'))).toEqual([
            'addLocalSeat:host-1-local-2:ready=true:null',
        ]);
    });

    it('replaces a default AI seat list wholesale when the request supplies one', async () => {
        const harness = makeHarness({
            resolveQuickStartDefaults: () => ({ aiSeats: [{}, {}, {}] }),
        });

        await harness.coordinator.quickStart({ gameId: GAME_ID, aiSeats: [{ omniscient: true }] });

        expect(harness.hostedAgentSlots()).toEqual([
            { slotIndex: 1, kind: 'ai', omniscient: true },
        ]);
    });

    it("resolves the game's defaults for the requested gameId", async () => {
        const resolveQuickStartDefaults = vi.fn(() => undefined);
        const harness = makeHarness({ resolveQuickStartDefaults });

        await harness.coordinator.quickStart({ gameId: GAME_ID });

        expect(resolveQuickStartDefaults).toHaveBeenCalledWith(GAME_ID);
    });
});

describe('QuickStartCoordinator.quickStart — guards', () => {
    it('rejects when a session is already active, without hosting', async () => {
        const harness = makeHarness({ hasActiveSession: () => true });

        await expect(harness.coordinator.quickStart({ gameId: GAME_ID })).rejects.toThrow(
            QuickStartError,
        );
        expect(harness.calls).toEqual([]);
    });

    it('rejects while a session restore is in flight, without hosting', async () => {
        const harness = makeHarness({ isRestoreActive: () => true });

        await expect(harness.coordinator.quickStart({ gameId: GAME_ID })).rejects.toThrow(
            /restore/i,
        );
        expect(harness.calls).toEqual([]);
    });

    it('rejects a second quick start while one is in flight, and the first still completes', async () => {
        let releaseHost = (): void => undefined;
        const harness = makeHarness({
            hostLobby: () =>
                new Promise<LobbyInfo>((resolve) => {
                    releaseHost = () => {
                        resolve(LOBBY_INFO);
                    };
                }),
        });

        const first = harness.coordinator.quickStart({ gameId: GAME_ID });
        expect(harness.coordinator.isActive()).toBe(true);

        await expect(harness.coordinator.quickStart({ gameId: GAME_ID })).rejects.toThrow(
            /in flight/i,
        );

        releaseHost();
        await expect(first).resolves.toEqual(LOBBY_INFO);
        expect(harness.coordinator.isActive()).toBe(false);
    });

    it('reports isActive() from the guard onwards so a restore can be refused mid-host', async () => {
        let releaseHost = (): void => undefined;
        const harness = makeHarness({
            hostLobby: () =>
                new Promise<LobbyInfo>((resolve) => {
                    releaseHost = () => {
                        resolve(LOBBY_INFO);
                    };
                }),
        });

        expect(harness.coordinator.isActive()).toBe(false);
        const inFlight = harness.coordinator.quickStart({ gameId: GAME_ID });
        // The hosting await is exactly the window in which the composition root
        // has no `activeSession` yet — the flag is what closes it.
        expect(harness.coordinator.isActive()).toBe(true);

        releaseHost();
        await inFlight;
        expect(harness.coordinator.isActive()).toBe(false);
    });

    it('clears the in-flight flag when the sequence fails', async () => {
        const harness = makeHarness({
            startGame: () => Promise.reject(new Error('start refused')),
        });

        await expect(harness.coordinator.quickStart({ gameId: GAME_ID })).rejects.toThrow(
            'start refused',
        );
        expect(harness.coordinator.isActive()).toBe(false);
    });

    it('rejects a request that would author the engine-owned session-mode key', async () => {
        const harness = makeHarness();

        await expect(
            harness.coordinator.quickStart({
                gameId: GAME_ID,
                matchSettings: { [SESSION_MODE_SETTING]: 'lobby' },
            }),
        ).rejects.toThrow(SESSION_MODE_SETTING);
        expect(harness.calls).toEqual([]);
    });

    it("rejects when the GAME's own quickStart defaults author the session-mode key", async () => {
        const harness = makeHarness({
            resolveQuickStartDefaults: () => ({
                matchSettings: { [SESSION_MODE_SETTING]: 'lobby' },
            }),
        });

        await expect(harness.coordinator.quickStart({ gameId: GAME_ID })).rejects.toThrow(
            QuickStartError,
        );
        expect(harness.calls).toEqual([]);
    });
});

describe('QuickStartCoordinator.quickStart — failure teardown', () => {
    const failingSteps: readonly (readonly [string, Partial<QuickStartPorts>])[] = [
        ['setMatchSetting', { setMatchSetting: () => Promise.reject(new Error('boom')) }],
        ['setPlayerAttribute', { setPlayerAttribute: () => Promise.reject(new Error('boom')) }],
        ['addLocalSeat', { addLocalSeat: () => Promise.reject(new Error('boom')) }],
        [
            'updatePlayerReadyState',
            { updatePlayerReadyState: () => Promise.reject(new Error('boom')) },
        ],
        ['startGame', { startGame: () => Promise.reject(new Error('boom')) }],
    ];

    for (const [step, override] of failingSteps) {
        it(`tears the lobby down when ${step} throws`, async () => {
            const harness = makeHarness(override);

            await expect(
                harness.coordinator.quickStart({
                    gameId: GAME_ID,
                    hostAttributes: { team: 'red' },
                    localSeats: [{}],
                }),
            ).rejects.toThrow('boom');

            expect(harness.calls.filter((call) => call === 'closeLobby')).toEqual(['closeLobby']);
        });
    }

    it('does NOT tear down when hosting itself failed — there is no lobby to close', async () => {
        const harness = makeHarness({
            hostLobby: () => Promise.reject(new Error('host refused')),
        });

        await expect(harness.coordinator.quickStart({ gameId: GAME_ID })).rejects.toThrow(
            'host refused',
        );
        expect(harness.calls).toEqual([]);
    });

    it('propagates the ORIGINAL failure when the teardown itself fails', async () => {
        const harness = makeHarness({
            startGame: () => Promise.reject(new Error('start refused')),
            closeLobby: () => Promise.reject(new Error('teardown refused')),
        });

        await expect(harness.coordinator.quickStart({ gameId: GAME_ID })).rejects.toThrow(
            'start refused',
        );
    });
});

// Referenced so the compile-time pin is not tree-shaken as unused.
export { managerSatisfiesLobbyVerbs };
