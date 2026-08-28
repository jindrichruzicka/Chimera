/**
 * electron/main/__tests__/ai-seat-setup-projection.integration.test.ts
 *
 * Integration test for the AI-seat leg of the lobby → match → projection road:
 * an AI agent slot's `attributes` must travel the SAME path a human
 * seat's do — `LobbyState` → `buildSetupFromLobbyState()` → the
 * `engine:start_game` payload → `GameSnapshot.setup` → every viewer's
 * `PlayerSnapshot.setup`, identical for all of them.
 *
 * Wires the REAL collaborators end to end (no doubles for the units under
 * test): the main-side setup builder, the engine's own `engine:start_game`
 * definition (`parsePayload` + `reduce`, so the wire-parse leg is exercised),
 * the synthetic AI id minter the host seats agents under, and
 * `DefaultStateProjector`.
 *
 * Architecture: §4.14 — LobbyManager; §4.6 — projection; §4.37.12
 *
 * Invariants upheld:
 *   #101 — `setup` is public host configuration passed through
 *          `StateProjector.project()` VERBATIM, so every viewer's projected
 *          snapshot carries an identical `setup`. Widened here by the AI-seat
 *          attribute carrier; the guarantee is unchanged.
 *
 * Tests written first (TDD — red confirmed: `buildSetupFromLobbyState` walked
 * `state.players` only, so the AI slot's attributes never reached `setup`).
 */

import { describe, it, expect } from 'vitest';
import type { LobbyState } from '@chimera-engine/networking';
import { playerId } from '@chimera-engine/networking';
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
import type { VisibilityRules } from '@chimera-engine/simulation/projection/types.js';
import { DefaultStateProjector } from '@chimera-engine/simulation/projection/StateProjector.js';
import { buildSetupFromLobbyState } from '../lobby/lobbySetupRegistry.js';
import { createSyntheticAIPlayerId } from '../runtime/syntheticAgentId.js';

const HOST = playerId('host');
const GUEST = playerId('guest');
const AI_SLOT_INDEX = 2;
const AI = createSyntheticAIPlayerId(AI_SLOT_INDEX);

/** `engine:start_game` reads neither the rng nor the dispatch depth. */
const reduceCtx = { rng: makeStubRng(0.5), dispatchDepth: 0 };

/** Everything public — this test is about `setup`, not about fog. */
const publicRules: VisibilityRules<BaseGameSnapshot, BaseEntityState, BasePlayerState> = {
    isEntityVisible: () => true,
    maskEntity: (entity) => entity,
    maskPlayerState: (target) => target,
    filterEvents: (events: readonly GameEvent[]) => events,
};

const lobbySnapshot: BaseGameSnapshot = {
    tick: 0,
    seed: 42,
    players: { [HOST]: { id: HOST }, [GUEST]: { id: GUEST } },
    entities: {},
    phase: gamePhase('lobby'),
    events: [],
    turnNumber: 0,
    hostPlayerId: HOST,
    timers: {},
    gameResult: null,
};

/**
 * A lobby exactly as the host holds it at Start: the host and a joined human in
 * `players`, and the AI in `agentSlots` (the UI adds AI after hosting, so an AI
 * seat is never a `players` entry).
 */
const lobbyState: LobbyState = {
    info: { sessionId: 'session-1', hostId: HOST, gameId: 'sample' },
    gameParams: { boardColor: 'slate' },
    players: [
        { playerId: HOST, displayName: 'Host', ready: true, attributes: { color: 'blue' } },
        { playerId: GUEST, displayName: 'Guest', ready: true, attributes: { color: 'red' } },
    ],
    agentSlots: [{ slotIndex: AI_SLOT_INDEX, kind: 'ai', attributes: { color: 'green' } }],
};

/** Runs the real road from the lobby state to one projected snapshot per viewer. */
function projectStartedMatch(state: LobbyState): {
    readonly started: BaseGameSnapshot;
    readonly views: ReadonlyMap<PlayerId, ReturnType<DefaultStateProjector['project']>>;
} {
    const setup = buildSetupFromLobbyState(state);
    const payload = engineStartGameDefinition.parsePayload({
        playerIds: [HOST, GUEST, AI],
        firstPlayerId: HOST,
        ...(setup !== undefined ? { setup } : {}),
    });
    // The host-only gate runs too, so the payload this test reduces is one the
    // pipeline would actually accept.
    const verdict = engineStartGameDefinition.validate(payload, lobbySnapshot, HOST, reduceCtx);
    if (!verdict.ok) {
        throw new Error(`engine:start_game rejected: ${verdict.reason}`);
    }
    const started = engineStartGameDefinition.reduce(lobbySnapshot, payload, HOST, reduceCtx);
    const projector = new DefaultStateProjector(publicRules);
    return {
        started,
        views: new Map(
            [HOST, GUEST, AI].map((viewer) => [viewer, projector.project(started, viewer)]),
        ),
    };
}

describe('AI-seat attributes reach every viewer’s snapshot.setup', () => {
    it("carries the AI slot's attributes into the started match's setup", () => {
        const { started } = projectStartedMatch(lobbyState);

        expect(started.setup).toEqual({
            gameParams: { boardColor: 'slate' },
            playerAttributes: {
                host: { color: 'blue' },
                guest: { color: 'red' },
                'ai-2': { color: 'green' },
            },
        });
    });

    it('projects an identical setup — including the AI seat — to every viewer', () => {
        const { started, views } = projectStartedMatch(lobbyState);

        for (const viewer of [HOST, GUEST, AI]) {
            const view = views.get(viewer);
            expect(view?.setup).toEqual(started.setup);
            // Verbatim passthrough: the same reference, not a per-viewer copy.
            expect(view?.setup).toBe(started.setup);
            expect(view?.setup?.playerAttributes[AI]).toEqual({ color: 'green' });
        }
    });

    it('gives the human seats the same view of the AI seat the AI itself has', () => {
        const { views } = projectStartedMatch(lobbyState);

        expect(views.get(HOST)?.setup).toEqual(views.get(AI)?.setup);
        expect(views.get(GUEST)?.setup).toEqual(views.get(AI)?.setup);
    });

    it('leaves the AI seat out of setup when its slot declares no attributes', () => {
        const { started } = projectStartedMatch({
            ...lobbyState,
            agentSlots: [{ slotIndex: AI_SLOT_INDEX, kind: 'ai' }],
        });

        expect(started.setup?.playerAttributes).toEqual({
            host: { color: 'blue' },
            guest: { color: 'red' },
        });
    });
});
