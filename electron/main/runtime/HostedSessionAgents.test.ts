/**
 * electron/main/runtime/HostedSessionAgents.test.ts
 *
 * Host-level AI wiring coverage for M4 F22/F25.
 *
 * Tests written first (TDD): red confirmed before implementation.
 */

import { describe, expect, it, vi } from 'vitest';
import {
    playerId,
    gamePhase,
    entityId,
    sceneId,
    type ActionEnvelope,
    type BaseGameSnapshot,
    type PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import type { PlayerSnapshot } from '@chimera-engine/simulation/projection/StateProjector.js';
import type { VisibilityRules } from '@chimera-engine/simulation/projection/types.js';
import type { AIState, PlayerAgent } from '@chimera-engine/ai';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { DefaultStateProjector } from '@chimera-engine/simulation/projection/index.js';
import { createTacticsAIState } from '@chimera-engine/tactics/ai/tacticsPolicy.js';
import { registerTacticsActions } from '@chimera-engine/tactics/simulation/actions.js';
import { tacticsVisibilityRules } from '@chimera-engine/tactics/simulation/visibility-rules.js';
import { TACTICS_MOVE_UNIT_ACTION } from '@chimera-engine/tactics/simulation/constants.js';
import type { LobbyAgentSlot } from '@chimera-engine/networking';
import {
    buildDefaultAIPlayerAgent,
    buildInitialHostedSessionSnapshot,
    buildReplayPlayers,
    collectGameStartAiPlayerSlots,
} from './HostedSessionAgents.js';
import { buildHostSessionPipeline } from './HostSessionPipeline.js';
import { SessionRuntime } from './SessionRuntime.js';
import type { Logger } from '../logging/logger.js';
import { createNoopLogger } from '../logging/logger.js';

const aiPlayerId = playerId('ai-0');
const humanPlayerId = playerId('human-1');

/** Mirrors `AI_DRIVE_MAX_DEPTH` in the composition root's AI drive pump. */
const AI_DRIVE_DEPTH_CAP = 512;

/**
 * Game id shared by the drive-pump harness's runtime, pipeline and registry —
 * `ActionPipeline` only resolves a `GameDefinition` (and therefore a game's
 * `mayEndTurn`) when its `gameId` matches one registered on the registry.
 */
const PUMP_GAME_ID = 'tactics';

/**
 * Game-agnostic visibility policy: everything is visible, nothing is masked.
 * The engine-default `engine:auto-end-turn` tests below exercise engine wiring,
 * not a game's fog rules, so they project through this rather than borrowing a
 * game's rules. Projection still strips the host-only fields (`seed`,
 * `turnClock`, …) that `PlayerSnapshot` does not declare — which is the point.
 */
const passThroughVisibilityRules: VisibilityRules = {
    isEntityVisible: () => true,
    maskEntity: (entity) => entity,
    maskPlayerState: (player) => player,
    filterEvents: (events) => events,
};

function makeProjector(): DefaultStateProjector {
    return new DefaultStateProjector(passThroughVisibilityRules);
}

/**
 * Captures the seed snapshot handed to `AIState.onEnter`.
 *
 * `AIStateMachineImpl` retains nothing — it nulls its snapshot field in a
 * `finally` and exposes no getter — so the injected `createState` factory is
 * the only seam through which the initial state is observable.
 */
function recordingState(seeds: PlayerSnapshot[]): (pid: PlayerId) => AIState {
    return () => ({
        name: 'test:seed-recorder',
        onEnter: (snapshot) => {
            seeds.push(snapshot);
        },
        onTick: () => undefined,
        onIdle: () => undefined,
        onExit: () => undefined,
    });
}

function makeSnapshot(): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 99,
        players: {
            [aiPlayerId]: { id: aiPlayerId },
            [humanPlayerId]: { id: humanPlayerId },
        },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: aiPlayerId,
        turnClock: {
            activePlayerId: aiPlayerId,
            deadlineMs: 30_000,
        },
        timers: {},
        gameResult: null,
    };
}

/** `makeSnapshot()` minus the turn clock — a game with no turn concept. */
function makeTurnClockLessSnapshot(): BaseGameSnapshot {
    const { turnClock: _turnClock, ...rest } = makeSnapshot();
    return rest;
}

describe('buildDefaultAIPlayerAgent', () => {
    it('dispatches engine:end_turn through the real host ActionPipeline when the AI is active', () => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        const { processAction } = buildHostSessionPipeline(registry, vi.fn());
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: makeSnapshot(),
            applyAction: processAction,
            now: () => 1_000,
        });

        const projector = makeProjector();
        const agent = buildDefaultAIPlayerAgent({
            playerId: aiPlayerId,
            initialSnapshot: runtime.getSnapshot(),
            dispatch: (action) => runtime.applyAction(action),
            logger: createNoopLogger(),
            projector,
        });

        // An honest agent is driven with PROJECTED snapshots (AgentManager does
        // exactly this), so the policy must key off `isMyTurn` — the projected
        // field — never a host-only field the projection drops.
        agent.onGameStart(projector.project(runtime.getSnapshot(), aiPlayerId));

        expect(runtime.getSnapshot().turnNumber).toBe(1);
        expect(runtime.getSnapshot().turnClock?.activePlayerId).toBe(humanPlayerId);
    });

    it('drives the AI through multiple turns in a full headless match', () => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        const { processAction } = buildHostSessionPipeline(registry, vi.fn());
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: makeSnapshot(),
            applyAction: processAction,
            now: () => 1_000,
        });

        const projector = makeProjector();
        const agent = buildDefaultAIPlayerAgent({
            playerId: aiPlayerId,
            initialSnapshot: runtime.getSnapshot(),
            dispatch: (action) => runtime.applyAction(action),
            logger: createNoopLogger(),
            projector,
        });

        // Turn 1: AI takes its turn
        agent.onGameStart(projector.project(runtime.getSnapshot(), aiPlayerId));
        expect(runtime.getSnapshot().turnNumber).toBe(1);
        expect(runtime.getSnapshot().turnClock?.activePlayerId).toBe(humanPlayerId);

        // Turn 2: Human takes its turn (manually dispatch)
        let snapshot = runtime.getSnapshot();
        runtime.applyAction({
            type: 'engine:end_turn',
            playerId: humanPlayerId,
            tick: snapshot.tick,
            payload: {},
        });
        snapshot = runtime.getSnapshot();
        expect(snapshot.turnNumber).toBe(2);
        expect(snapshot.turnClock?.activePlayerId).toBe(aiPlayerId);

        // Turn 3: AI takes its second turn (onTick triggers the agent to dispatch)
        const projected = projector.project(snapshot, aiPlayerId);
        agent.onTick(projected, projected.tick);
        snapshot = runtime.getSnapshot();
        expect(snapshot.turnNumber).toBe(3);
        expect(snapshot.turnClock?.activePlayerId).toBe(humanPlayerId);

        // Turn 4: Human takes second turn
        runtime.applyAction({
            type: 'engine:end_turn',
            playerId: humanPlayerId,
            tick: snapshot.tick,
            payload: {},
        });
        snapshot = runtime.getSnapshot();
        expect(snapshot.turnNumber).toBe(4);
        expect(snapshot.turnClock?.activePlayerId).toBe(aiPlayerId);

        // Verify we've completed a multi-turn cycle without errors
        expect(snapshot.turnNumber).toBeGreaterThanOrEqual(4);
    });

    // The host re-ticks every agent inside its own dispatch (`dispatchAiAction`
    // → `runHostAction` → `afterTick` → `tickAll`), which is what lets a policy
    // spend a whole turn in one go. A policy that re-asks for an unchanged
    // snapshot therefore recurses to the drive-depth cap instead of settling.
    describe('turn-gate termination', () => {
        /**
         * Drives ONE idle tick through the real pipeline, re-ticking the agent
         * from inside its own dispatch exactly as the composition root's AI
         * drive pump does. Every termination claim about this policy has to be
         * made against this, not against a `dispatch` stub: a stub cannot
         * re-enter, so it reports one dispatch no matter how the policy behaves.
         */
        function driveOneIdleTick(
            initialSnapshot: BaseGameSnapshot,
            overrides: {
                readonly projector?: DefaultStateProjector;
                readonly mayEndTurn?: (state: Readonly<BaseGameSnapshot>, pid: PlayerId) => boolean;
                readonly logger?: Logger;
                /** Top-level agent ticks, as successive host actions deliver them. */
                readonly outerTicks?: number;
            } = {},
        ): {
            readonly actions: readonly ActionEnvelope[];
            readonly finalTick: number;
        } {
            const registry = new ActionRegistry();
            registerEngineActions(registry);
            if (overrides.mayEndTurn !== undefined) {
                registry.registerGame(PUMP_GAME_ID, { mayEndTurn: overrides.mayEndTurn });
            }
            const { processAction } = buildHostSessionPipeline(registry, vi.fn(), {
                gameId: PUMP_GAME_ID,
                savePort: { autoSave: () => Promise.resolve() },
            });
            const runtime = new SessionRuntime({
                gameId: PUMP_GAME_ID,
                gameVersion: '0.1.0',
                initialSnapshot,
                applyAction: processAction,
                now: () => 1_000,
            });
            const projector = overrides.projector ?? makeProjector();

            const actions: ActionEnvelope[] = [];
            let depth = 0;
            const agentRef: { current: PlayerAgent | null } = { current: null };
            const dispatch = (action: ActionEnvelope): void => {
                actions.push(action);
                if (depth >= AI_DRIVE_DEPTH_CAP) {
                    return;
                }
                depth += 1;
                try {
                    runtime.applyAction(action);
                    const next = projector.project(runtime.getSnapshot(), aiPlayerId);
                    agentRef.current?.onTick(next, next.tick);
                } finally {
                    depth -= 1;
                }
            };

            agentRef.current = buildDefaultAIPlayerAgent({
                playerId: aiPlayerId,
                initialSnapshot: runtime.getSnapshot(),
                dispatch,
                logger: overrides.logger ?? createNoopLogger(),
                projector,
            });

            for (let pump = 0; pump < (overrides.outerTicks ?? 1); pump += 1) {
                const projected = projector.project(runtime.getSnapshot(), aiPlayerId);
                agentRef.current.onTick(projected, projected.tick);
            }
            return { actions, finalTick: runtime.getSnapshot().tick };
        }

        it('asks to end the turn at most once per tick when engine:end_turn cannot advance it', () => {
            // No turnClock: projection reports isMyTurn=true for EVERY viewer,
            // and `engine:end_turn` reduces to the identity — so the tick never
            // moves and the policy is handed back a snapshot it already acted on.
            const result = driveOneIdleTick(makeTurnClockLessSnapshot());

            expect(result.finalTick).toBe(0);
            expect(result.actions).toHaveLength(1);
        });

        it('does not re-ask across later ticks of the agent at a tick it already acted on', () => {
            // The re-entrancy guard only spans one pump. Repeat delivery at an
            // unchanged tick is what the tick latch is for: the counter is
            // advanced by individual reducers, not by the pipeline, so any two
            // host actions whose reducers leave it alone re-tick every agent
            // with a snapshot it has already acted on.
            const result = driveOneIdleTick(makeTurnClockLessSnapshot(), { outerTicks: 3 });

            expect(result.finalTick).toBe(0);
            expect(result.actions).toHaveLength(1);
        });

        it('settles after one dispatch when the turn clock does advance', () => {
            const result = driveOneIdleTick(makeSnapshot());

            expect(result.actions).toHaveLength(1);
            expect(result.finalTick).toBe(1);
        });

        it('stays silent while the turn belongs to someone else', () => {
            const otherSeatActive: BaseGameSnapshot = {
                ...makeSnapshot(),
                turnClock: { activePlayerId: humanPlayerId, deadlineMs: 30_000 },
            };

            expect(driveOneIdleTick(otherSeatActive).actions).toHaveLength(0);
        });

        it("honours a game's resolveIsMyTurn override for a seat the turn clock calls inactive", () => {
            // Simultaneous-turn games mark every uncommitted seat active, and
            // supply `mayEndTurn` so a non-active seat is authorised to end the
            // turn. The seat therefore stays `isMyTurn` across a SUCCESSFUL
            // end-turn — the tick advances every iteration, so a latch keyed on
            // the tick cannot stop the re-entrant pump. Only one request may
            // leave the policy per pump.
            const result = driveOneIdleTick(
                {
                    ...makeSnapshot(),
                    turnClock: { activePlayerId: humanPlayerId, deadlineMs: 30_000 },
                },
                {
                    projector: new DefaultStateProjector(passThroughVisibilityRules, {
                        resolveIsMyTurn: () => true,
                    }),
                    mayEndTurn: () => true,
                },
            );

            expect(result.actions.map((action) => action.type)).toStrictEqual(['engine:end_turn']);
            expect(result.finalTick).toBe(1);
        });

        it('stops after one request when the round-robin hands the turn straight back', () => {
            // A roster of one: `engine:end_turn` advances the tick and returns
            // the turn to the same seat. Tick-keyed latching sees a fresh tick
            // every iteration; the re-entrancy guard is what terminates this.
            const soleSeat: BaseGameSnapshot = {
                ...makeSnapshot(),
                players: { [aiPlayerId]: { id: aiPlayerId } },
            };

            const result = driveOneIdleTick(soleSeat);

            expect(result.actions).toHaveLength(1);
            expect(result.finalTick).toBe(1);
        });

        it('stays silent once the session is back in the lobby', () => {
            // `engine:return_to_lobby` drops the turn clock, and a snapshot with
            // no turn clock projects isMyTurn=true for every viewer. Ending a
            // turn in the lobby also rewrites the autosave slot with a
            // lobby-phase file, discarding the abandoned match's autosave.
            const backInLobby: BaseGameSnapshot = {
                ...makeTurnClockLessSnapshot(),
                phase: gamePhase('lobby'),
            };

            expect(driveOneIdleTick(backInLobby).actions).toHaveLength(0);
        });

        it('stays silent once the match has a result', () => {
            const finished: BaseGameSnapshot = {
                ...makeSnapshot(),
                gameResult: { winnerIds: [humanPlayerId] },
            };

            expect(driveOneIdleTick(finished).actions).toHaveLength(0);
        });

        it('contains a rejected end turn instead of unwinding into the host action', () => {
            // A game may supply `resolveIsMyTurn` (projection) without
            // `mayEndTurn` (authorisation) — they are separate seams. The
            // engine then rejects, and `ActionPipeline` signals rejection by
            // THROWING: nothing between `context.dispatch` and the host action
            // that drove the fan-out catches it, so an escaping error would
            // fail a human's action or the realtime ticker's callback.
            const warn = vi.fn();
            const logger: Logger = { ...createNoopLogger(), warn };

            const result = driveOneIdleTick(
                {
                    ...makeSnapshot(),
                    turnClock: { activePlayerId: humanPlayerId, deadlineMs: 30_000 },
                },
                {
                    projector: new DefaultStateProjector(passThroughVisibilityRules, {
                        resolveIsMyTurn: () => true,
                    }),
                    logger,
                },
            );

            expect(result.actions).toHaveLength(1);
            expect(result.finalTick).toBe(0);
            expect(warn).toHaveBeenCalledTimes(1);
        });
    });
});

describe('buildDefaultAIPlayerAgent with the tactics policy (issue #725)', () => {
    const aiUnit = entityId('ai-unit');
    const enemyUnit = entityId('enemy-unit');

    function makeTacticsSnapshot(enemy: {
        readonly x: number;
        readonly y: number;
        readonly visibleToAI: boolean;
    }): BaseGameSnapshot {
        const entities = {
            [aiUnit]: {
                id: aiUnit,
                kind: 'unit',
                ownerId: aiPlayerId,
                x: 0,
                y: 0,
                hp: 1,
                visibleTo: [aiPlayerId],
            },
            [enemyUnit]: {
                id: enemyUnit,
                kind: 'unit',
                ownerId: humanPlayerId,
                x: enemy.x,
                y: enemy.y,
                hp: 1,
                visibleTo: enemy.visibleToAI ? [humanPlayerId, aiPlayerId] : [humanPlayerId],
            },
        } as unknown as BaseGameSnapshot['entities'];
        return {
            tick: 0,
            seed: 99,
            players: {
                [aiPlayerId]: { id: aiPlayerId },
                [humanPlayerId]: { id: humanPlayerId },
            },
            entities,
            phase: gamePhase('playing'),
            events: [],
            turnNumber: 0,
            hostPlayerId: aiPlayerId,
            turnClock: { activePlayerId: aiPlayerId, deadlineMs: 30_000 },
            timers: {},
            gameResult: null,
        };
    }

    function makeTacticsRuntime(initialSnapshot: BaseGameSnapshot): {
        readonly runtime: SessionRuntime;
        readonly projector: DefaultStateProjector;
    } {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        registerTacticsActions(registry);
        const { processAction } = buildHostSessionPipeline(registry, vi.fn());
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot,
            applyAction: processAction,
            now: () => 1_000,
        });
        return { runtime, projector: new DefaultStateProjector(tacticsVisibilityRules) };
    }

    it('attacks an adjacent visible enemy through the real host ActionPipeline', () => {
        const { runtime, projector } = makeTacticsRuntime(
            makeTacticsSnapshot({ x: 1, y: 0, visibleToAI: true }),
        );
        const agent = buildDefaultAIPlayerAgent({
            playerId: aiPlayerId,
            initialSnapshot: runtime.getSnapshot(),
            dispatch: (action) => runtime.applyAction(action),
            logger: createNoopLogger(),
            createState: createTacticsAIState,
            projector,
        });

        const projected = projector.project(runtime.getSnapshot(), aiPlayerId);
        agent.onTick(projected, projected.tick);

        const enemy = runtime.getSnapshot().entities[enemyUnit] as unknown as {
            readonly hp: number;
        };
        expect(enemy.hp).toBe(0);
    });

    it('respects stamina (3 actions) then ends the turn when no enemy is in reach (AC4)', () => {
        const { runtime, projector } = makeTacticsRuntime(
            // Enemy parked in the far corner and not visible to the AI: it wanders.
            makeTacticsSnapshot({ x: 3, y: -2, visibleToAI: false }),
        );
        const dispatched: ActionEnvelope[] = [];
        const agent = buildDefaultAIPlayerAgent({
            playerId: aiPlayerId,
            initialSnapshot: runtime.getSnapshot(),
            dispatch: (action) => {
                dispatched.push(action);
                runtime.applyAction(action);
            },
            logger: createNoopLogger(),
            createState: createTacticsAIState,
            projector,
        });

        // Drive enough idle ticks to exhaust stamina and pass the turn.
        for (let i = 0; i < 6; i += 1) {
            const projected = projector.project(runtime.getSnapshot(), aiPlayerId);
            agent.onTick(projected, projected.tick);
        }

        const moves = dispatched.filter((action) => action.type === TACTICS_MOVE_UNIT_ACTION);
        expect(moves).toHaveLength(3); // exactly the per-turn stamina budget
        expect(dispatched.some((action) => action.type === 'engine:end_turn')).toBe(true);
        expect(runtime.getSnapshot().turnClock?.activePlayerId).toBe(humanPlayerId);
    });

    // Invariant #17: the SEED snapshot handed to `AIState.onEnter` is a state
    // delivery like any other, so it must come from the projector. A raw
    // `GameSnapshot` spread into `PlayerSnapshot` shape type-checks — TypeScript
    // does not excess-property-check spread-in members — so only a behavioural
    // assertion can tell the two apart.
    describe('initial-state projection (Invariant #17)', () => {
        it('seeds an honest agent from the projection, not the raw host snapshot', () => {
            const { runtime, projector } = makeTacticsRuntime(
                // Enemy parked out of the AI's reveal list: genuinely fog-hidden.
                makeTacticsSnapshot({ x: 3, y: -2, visibleToAI: false }),
            );
            const seeds: PlayerSnapshot[] = [];

            buildDefaultAIPlayerAgent({
                playerId: aiPlayerId,
                initialSnapshot: runtime.getSnapshot(),
                dispatch: () => undefined,
                logger: createNoopLogger(),
                createState: recordingState(seeds),
                projector,
            });

            expect(seeds).toHaveLength(1);
            const seed = seeds[0]!;
            // Fog-hidden opponent entity is ABSENT (never null) — Invariant #1.
            expect(seed.entities[enemyUnit]).toBeUndefined();
            // `maskEntity` strips the host-internal reveal list.
            expect(seed.entities[aiUnit]).not.toHaveProperty('visibleTo');
            // Host-only roots the projection never emits.
            expect(seed).not.toHaveProperty('seed');
            expect(seed).not.toHaveProperty('turnClock');
            expect(seed).not.toHaveProperty('turnNumber');
            expect(seed).not.toHaveProperty('hostPlayerId');
            expect(seed).not.toHaveProperty('timers');
        });

        it('seeds an honest agent with exactly the projected field set (re-widening ratchet)', () => {
            const snapshot = makeTacticsSnapshot({ x: 3, y: -2, visibleToAI: false });
            const { runtime, projector } = makeTacticsRuntime(snapshot);
            const seeds: PlayerSnapshot[] = [];

            buildDefaultAIPlayerAgent({
                playerId: aiPlayerId,
                initialSnapshot: runtime.getSnapshot(),
                dispatch: () => undefined,
                logger: createNoopLogger(),
                createState: recordingState(seeds),
                projector,
            });

            // Exact-set, not a not.toHaveProperty list: only this catches a
            // future re-widening by a field nobody thought to name.
            expect(Object.keys(seeds[0]!).sort()).toStrictEqual(
                Object.keys(projector.project(runtime.getSnapshot(), aiPlayerId)).sort(),
            );
        });

        it('keeps seeding an omniscient agent from the full snapshot (declared access preserved)', () => {
            const { runtime, projector } = makeTacticsRuntime(
                makeTacticsSnapshot({ x: 3, y: -2, visibleToAI: false }),
            );
            const seeds: PlayerSnapshot[] = [];

            buildDefaultAIPlayerAgent({
                playerId: aiPlayerId,
                initialSnapshot: runtime.getSnapshot(),
                dispatch: () => undefined,
                logger: createNoopLogger(),
                createState: recordingState(seeds),
                projector,
                omniscient: true,
            });

            const seed = seeds[0]!;
            expect(seed.entities[enemyUnit]).toBeDefined();
            expect(seed).toHaveProperty('seed');
            expect(seed.viewerId).toBe(aiPlayerId);
        });
    });
});

describe('buildInitialHostedSessionSnapshot', () => {
    it('uses injected initialEntities when provided', () => {
        const host = playerId('host-entities-1');
        const customId = entityId('unit-custom');
        const customEntities: BaseGameSnapshot['entities'] = {
            [customId]: { id: customId },
        };

        const snapshot = buildInitialHostedSessionSnapshot({
            seed: 42,
            hostPlayerId: host,
            playerSlots: [{ slotIndex: 0, playerId: host }],
            phase: gamePhase('lobby'),
            initialEntities: customEntities,
        });

        expect(snapshot.entities).toBe(customEntities);
    });

    it('uses an explicit firstPlayer for the initial turn clock at tick 0', () => {
        const host = playerId('host-first-player-1');
        const client = playerId('client-first-player-1');

        const snapshot = buildInitialHostedSessionSnapshot({
            seed: 42,
            hostPlayerId: host,
            firstPlayer: client,
            playerSlots: [
                { slotIndex: 0, playerId: host },
                { slotIndex: 1, playerId: client },
            ],
            phase: gamePhase('lobby'),
        });

        expect(snapshot.tick).toBe(0);
        expect(snapshot.turnClock).toEqual({ activePlayerId: client, deadlineMs: 30_000 });
    });

    it('yields empty entities when initialEntities is not provided', () => {
        const host = playerId('host-entities-2');

        const snapshot = buildInitialHostedSessionSnapshot({
            seed: 42,
            hostPlayerId: host,
            playerSlots: [{ slotIndex: 0, playerId: host }],
            phase: gamePhase('lobby'),
        });

        expect(snapshot.entities).toEqual({});
    });

    it('serializes the lobby scene as the initial hosted scene', () => {
        const host = playerId('host-scene-1');

        const snapshot = buildInitialHostedSessionSnapshot({
            seed: 42,
            hostPlayerId: host,
            playerSlots: [{ slotIndex: 0, playerId: host }],
            phase: gamePhase('lobby'),
        });

        expect(snapshot.sceneId).toBe(sceneId('engine:lobby'));
        expect(snapshot.sceneTransition).toBeNull();
    });
});

describe('collectGameStartAiPlayerSlots', () => {
    // The seating fix (#730 follow-up): a lobby-added AI seat must be derived from
    // the LIVE lobby `agentSlots` at game-start, since the host-time metadata
    // captured by `collectInitialPlayerSlots` is empty (AI is added after hosting).
    it('returns no slots when there are no agent slots', () => {
        expect(collectGameStartAiPlayerSlots(undefined)).toEqual([]);
        expect(collectGameStartAiPlayerSlots([])).toEqual([]);
    });

    it('maps an AI slot to its synthetic player id, preserving the slot index', () => {
        const slots: readonly LobbyAgentSlot[] = [{ slotIndex: 1, kind: 'ai' }];

        expect(collectGameStartAiPlayerSlots(slots)).toEqual([
            { slotIndex: 1, playerId: playerId('ai-1') },
        ]);
    });

    it('ignores human slots and preserves AI order', () => {
        const slots: readonly LobbyAgentSlot[] = [
            { slotIndex: 1, kind: 'ai' },
            { slotIndex: 2, kind: 'human' },
            { slotIndex: 3, kind: 'ai' },
        ];

        expect(collectGameStartAiPlayerSlots(slots)).toEqual([
            { slotIndex: 1, playerId: playerId('ai-1') },
            { slotIndex: 3, playerId: playerId('ai-3') },
        ]);
    });
});

describe('buildReplayPlayers', () => {
    it('resolves each slot to its directory display name', () => {
        const host = playerId('host-1');
        const client = playerId('client-2');

        const players = buildReplayPlayers(
            [
                { slotIndex: 0, playerId: host },
                { slotIndex: 1, playerId: client },
            ],
            (id) => (id === host ? 'Alice' : id === client ? 'Bob' : undefined),
        );

        expect(players).toEqual([
            { playerId: host, displayName: 'Alice' },
            { playerId: client, displayName: 'Bob' },
        ]);
    });

    it('falls back to the stringified playerId when no display name is known', () => {
        const ai = playerId('ai-1');

        const players = buildReplayPlayers([{ slotIndex: 1, playerId: ai }], () => undefined);

        expect(players).toEqual([{ playerId: ai, displayName: String(ai) }]);
    });

    it('preserves slot order', () => {
        const a = playerId('a');
        const b = playerId('b');
        const c = playerId('c');

        const players = buildReplayPlayers(
            [
                { slotIndex: 2, playerId: c },
                { slotIndex: 0, playerId: a },
                { slotIndex: 1, playerId: b },
            ],
            () => undefined,
        );

        expect(players.map((p) => p.playerId)).toEqual([c, a, b]);
    });
});
