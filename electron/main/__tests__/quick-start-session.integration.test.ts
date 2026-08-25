/**
 * electron/main/__tests__/quick-start-session.integration.test.ts
 *
 * Integration test for the quick-start road: `chimera:lobby:quick-start` →
 * `QuickStartCoordinator` → the REAL `LobbyManager` (over
 * `InMemoryMultiplayerProvider`) → `buildSetupFromLobbyState()` → the engine's
 * own `engine:start_game` definition → `DefaultStateProjector`.
 *
 * Only the composition-root ports are doubled; every collaborator on the path
 * under test is real, so the seat arithmetic, the `agentSlots` pre-seeding, the
 * pass-and-play seat attributes and the `engine.sessionMode` stamp are measured
 * where they actually land rather than against a lobby literal.
 *
 * Architecture: §4.14 — LobbyManager / session lifecycle; §4.6 — projection
 *
 * Invariants upheld:
 *   #99 — the coordinator authors match settings as the HOST and seat
 *         attributes as the SEAT OWNER; the host connection owns every local
 *         seat on a shared machine, seeded at host time.
 *   #101 — `setup` is passed through `StateProjector.project()` VERBATIM, so
 *         every viewer sees an identical one, stamp included.
 *
 * Tests written first (TDD — red confirmed: `QuickStartCoordinator` did not
 * exist and `addLocalSeat` ignored a caller-supplied attributes map).
 */

import { describe, expect, it } from 'vitest';
import type { LobbyInfo, LobbyState } from '@chimera-engine/networking';
import { InMemoryMultiplayerProvider } from '@chimera-engine/networking/provider/InMemoryMultiplayerProvider.js';
import { engineStartGameDefinition } from '@chimera-engine/simulation/engine/EngineActions.js';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    GameEvent,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { gamePhase } from '@chimera-engine/simulation/engine/types.js';
import { makeStubRng } from '@chimera-engine/simulation/engine/__test-support__/stubs.js';
import type { GameLobbySetup } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import {
    SESSION_MODE_QUICK,
    SESSION_MODE_SETTING,
    resolvePlayerAttributeDefaults,
} from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import { DefaultStateProjector } from '@chimera-engine/simulation/projection/StateProjector.js';
import type { VisibilityRules } from '@chimera-engine/simulation/projection/types.js';
import { createNoopLogger } from '../logging/logger.js';
import { LobbyManager } from '../lobby/LobbyManager.js';
import { buildSetupFromLobbyState } from '../lobby/lobbySetupRegistry.js';
import { classifyJoin } from '../lobby/joinClassifier.js';
import { collectGameStartAiPlayerSlots } from '../runtime/HostedSessionAgents.js';
import { QuickStartCoordinator } from '../runtime/QuickStartCoordinator.js';

const GAME_ID = 'sample';

/** Seat 0 → red, seat 1 → blue, seat 2 → red … plus a banner every seat shares. */
const SETUP: GameLobbySetup = {
    maxPlayers: 4,
    // Two settings on purpose: the "rides beside" test overrides one and must
    // be able to see the other survive.
    matchSettingsDefaults: { mapSize: 'medium', fogOfWar: 'on' },
    matchSettingsOptions: {},
    playerAttributeOptions: {},
    resolveDefaultPlayerAttributes: (seatIndex) => ({
        team: seatIndex % 2 === 0 ? 'red' : 'blue',
        banner: 'wolf',
    }),
};

/** Everything public — this test is about `setup`, not about fog. */
const publicRules: VisibilityRules<BaseGameSnapshot, BaseEntityState, BasePlayerState> = {
    isEntityVisible: () => true,
    maskEntity: (entity) => entity,
    maskPlayerState: (target) => target,
    filterEvents: (events: readonly GameEvent[]) => events,
};

interface Harness {
    readonly manager: LobbyManager;
    readonly coordinator: QuickStartCoordinator;
    /** Lobby state as the host held it at Start, or null if start never fired. */
    readonly startedWith: () => LobbyState | null;
    /** Every lobby-state push, in order, from the hosting one onwards. */
    readonly pushes: readonly LobbyState[];
}

function makeHarness(): Harness {
    const pushes: LobbyState[] = [];
    let startedWith: LobbyState | null = null;
    const manager = new LobbyManager(new InMemoryMultiplayerProvider(), createNoopLogger(), {
        resolveLobbySetup: (gameId) => (gameId === GAME_ID ? SETUP : undefined),
        onLobbyStateChanged: (state) => pushes.push(state),
        onGameStartRequested: (state) => {
            startedWith = state;
        },
    });
    // Bound exactly as the composition root binds them.
    const coordinator = new QuickStartCoordinator({
        logger: createNoopLogger(),
        ports: {
            hasActiveSession: () => manager.getCurrentState() !== null,
            isRestoreActive: () => false,
            resolveQuickStartDefaults: () => undefined,
            resolveSeatDefaultAttributes: (gameId, seatIndex) =>
                gameId === GAME_ID ? resolvePlayerAttributeDefaults(SETUP, seatIndex) : {},
            hostLobby: (params) => manager.hostLobby(params),
            setMatchSetting: (key, value) => manager.setMatchSetting(key, value),
            setPlayerAttribute: (target, key, value) =>
                manager.setPlayerAttribute(target, key, value),
            addLocalSeat: (seatId, options) => manager.addLocalSeat(seatId, options),
            updatePlayerReadyState: (ready) => manager.updatePlayerReadyState(ready),
            startGame: () => manager.startGame(),
            closeLobby: () => manager.closeLobby(),
        },
    });
    return { manager, coordinator, startedWith: () => startedWith, pushes };
}

/** Runs the real road from the Start-time lobby state to one view per viewer. */
function projectStartedMatch(state: LobbyState): {
    readonly started: BaseGameSnapshot;
    readonly viewers: readonly PlayerId[];
    readonly views: ReadonlyMap<PlayerId, ReturnType<DefaultStateProjector['project']>>;
} {
    const humanIds = state.players.map((entry) => entry.playerId);
    const aiIds = collectGameStartAiPlayerSlots(state.agentSlots).map((slot) => slot.playerId);
    const viewers = [...humanIds, ...aiIds];
    const hostId = state.info.hostId;
    const lobbySnapshot: BaseGameSnapshot = {
        tick: 0,
        seed: 42,
        players: Object.fromEntries(viewers.map((id) => [id, { id }])),
        entities: {},
        phase: gamePhase('lobby'),
        events: [],
        turnNumber: 0,
        hostPlayerId: hostId,
        timers: {},
        gameResult: null,
    };
    const setup = buildSetupFromLobbyState(state);
    const payload = engineStartGameDefinition.parsePayload({
        playerIds: viewers,
        firstPlayerId: hostId,
        ...(setup !== undefined ? { setup } : {}),
    });
    const ctx = { rng: makeStubRng(0.5), dispatchDepth: 0 };
    const verdict = engineStartGameDefinition.validate(payload, lobbySnapshot, hostId, ctx);
    if (!verdict.ok) {
        throw new Error(`engine:start_game rejected: ${verdict.reason}`);
    }
    const started = engineStartGameDefinition.reduce(lobbySnapshot, payload, hostId, ctx);
    const projector = new DefaultStateProjector(publicRules);
    return {
        started,
        viewers,
        views: new Map(viewers.map((viewer) => [viewer, projector.project(started, viewer)])),
    };
}

describe('quick start — the engine.sessionMode stamp', () => {
    it('reaches every viewer’s snapshot.setup, identically', async () => {
        const harness = makeHarness();

        await harness.coordinator.quickStart({
            gameId: GAME_ID,
            localSeats: [{}],
            aiSeats: [{}],
        });

        const state = harness.startedWith();
        expect(state).not.toBeNull();
        const { started, viewers, views } = projectStartedMatch(state!);

        expect(started.setup?.matchSettings[SESSION_MODE_SETTING]).toBe(SESSION_MODE_QUICK);
        for (const viewer of viewers) {
            // Verbatim passthrough — the same reference, not a per-viewer copy.
            expect(views.get(viewer)?.setup).toBe(started.setup);
        }
    });

    it("rides beside the game's own settings without displacing them", async () => {
        const harness = makeHarness();

        await harness.coordinator.quickStart({
            gameId: GAME_ID,
            matchSettings: { mapSize: 'small' },
        });

        const { started } = projectStartedMatch(harness.startedWith()!);

        expect(started.setup?.matchSettings).toEqual({
            // The request's override of a declared default …
            mapSize: 'small',
            // … a declared default the request never names, still standing …
            fogOfWar: 'on',
            // … and the stamp beside both.
            [SESSION_MODE_SETTING]: SESSION_MODE_QUICK,
        });
    });

    it('is absent from the hosting push and present on every push after it', async () => {
        const harness = makeHarness();

        await harness.coordinator.quickStart({ gameId: GAME_ID, localSeats: [{}] });

        // The transient lobby-phase broadcasts a quick start emits are never
        // routed to by the renderer, but a subscriber CAN read them: this pins
        // the exact window in which one is not yet distinguishable from a
        // lobby-born session — the hosting push, and only it.
        expect(harness.pushes.length).toBeGreaterThan(1);
        const stamps = harness.pushes.map(
            (state) => state.matchSettings?.[SESSION_MODE_SETTING] ?? null,
        );
        expect(stamps[0]).toBeNull();
        expect(stamps.slice(1)).toEqual(
            Array.from({ length: stamps.length - 1 }, () => SESSION_MODE_QUICK),
        );
    });
});

describe('quick start — seat attributes', () => {
    it('lands every seat kind’s attributes in setup, keyed by its own id', async () => {
        const harness = makeHarness();

        await harness.coordinator.quickStart({
            gameId: GAME_ID,
            hostAttributes: { team: 'gold' },
            localSeats: [{ attributes: { team: 'silver' } }],
            aiSeats: [{ attributes: { team: 'bronze' } }],
        });

        const state = harness.startedWith()!;
        const { started } = projectStartedMatch(state);
        const hostId = state.info.hostId;

        expect(started.setup?.playerAttributes).toEqual({
            [hostId]: { team: 'gold', banner: 'wolf' },
            [`${String(hostId)}-local-2`]: { team: 'silver', banner: 'wolf' },
            'ai-2': { team: 'bronze', banner: 'wolf' },
        });
    });

    it("falls back to the game's seat defaults for a seat that declares none", async () => {
        const harness = makeHarness();

        await harness.coordinator.quickStart({
            gameId: GAME_ID,
            localSeats: [{}],
            aiSeats: [{}],
        });

        const state = harness.startedWith()!;
        const { started } = projectStartedMatch(state);
        const hostId = state.info.hostId;

        // Seat 0 → red, seat 1 (the local seat) → blue, seat 2 (the AI) → red.
        expect(started.setup?.playerAttributes).toEqual({
            [hostId]: { team: 'red', banner: 'wolf' },
            [`${String(hostId)}-local-2`]: { team: 'blue', banner: 'wolf' },
            'ai-2': { team: 'red', banner: 'wolf' },
        });
    });
});

describe('quick start — the solo roster', () => {
    it('reaches the playing phase with a single seat and no agent slots', async () => {
        const harness = makeHarness();

        await harness.coordinator.quickStart({ gameId: GAME_ID });

        const state = harness.startedWith()!;
        expect(state.players).toHaveLength(1);
        expect(state.agentSlots).toBeUndefined();

        const { started } = projectStartedMatch(state);
        expect(started.phase).toBe(gamePhase('playing'));
    });

    it('cleanly rejects a late join into the running solo match', async () => {
        const harness = makeHarness();
        await harness.coordinator.quickStart({ gameId: GAME_ID });
        const { started } = projectStartedMatch(harness.startedWith()!);

        // The host's real classifier, fed the phase the solo match actually
        // reached. A solo lobby is full at one seat, but occupancy is not what
        // closes the door — the match being under way is.
        expect(
            classifyJoin({
                phase: started.phase,
                reconnect: false,
                spectatorSupport: undefined,
                allowSpectators: false,
            }),
        ).toEqual({ reject: 'match_in_progress' });
    });

    it('refuses to add an AI into a full solo lobby', async () => {
        const harness = makeHarness();
        await harness.coordinator.quickStart({ gameId: GAME_ID });

        await expect(harness.manager.addAi()).rejects.toThrow(/lobby is full/i);
    });
});

describe('quick start — failure teardown', () => {
    it('leaves no session behind when the start is refused', async () => {
        const harness = makeHarness();
        // maxPlayers 2 (host + one local seat), but the roster never readies:
        // hijack the local-seat add so the seat lands NOT ready and startGame
        // hits its all-ready gate.
        const info: LobbyInfo = await harness.manager.hostLobby({
            gameId: GAME_ID,
            maxPlayers: 2,
        });
        expect(info.hostId).toBeTruthy();
        await harness.manager.closeLobby();

        const failing = new QuickStartCoordinator({
            logger: createNoopLogger(),
            ports: {
                hasActiveSession: () => harness.manager.getCurrentState() !== null,
                isRestoreActive: () => false,
                resolveQuickStartDefaults: () => undefined,
                resolveSeatDefaultAttributes: () => ({}),
                hostLobby: (params) => harness.manager.hostLobby(params),
                setMatchSetting: (key, value) => harness.manager.setMatchSetting(key, value),
                setPlayerAttribute: (target, key, value) =>
                    harness.manager.setPlayerAttribute(target, key, value),
                addLocalSeat: (seatId) => harness.manager.addLocalSeat(seatId, { ready: false }),
                updatePlayerReadyState: (ready) => harness.manager.updatePlayerReadyState(ready),
                startGame: () => harness.manager.startGame(),
                closeLobby: () => harness.manager.closeLobby(),
            },
        });

        await expect(failing.quickStart({ gameId: GAME_ID, localSeats: [{}] })).rejects.toThrow(
            /all players must be ready/i,
        );

        // No zombie: the lobby is gone, so the next quick start may host again.
        expect(harness.manager.getCurrentState()).toBeNull();
        expect(failing.isActive()).toBe(false);
        await expect(failing.quickStart({ gameId: GAME_ID })).resolves.toBeTruthy();
    });
});
