// simulation/scene/__tests__/terminal-match-transition.test.ts
//
// What a scene transition already in flight can and cannot do once the match
// has resolved, driven through the real `ActionPipeline` rather than through
// the gate's predicate — the predicate says which actions are ADMITTED, and
// every question below is about what happens after they are.
//
// Architecture references: §4.7 action pipeline, §4.18–§4.19 scene transitions.

import { describe, expect, it } from 'vitest';
import { ActionPipeline, ActionUnauthorizedError } from '../../engine/ActionPipeline.js';
import { ActionRegistry } from '../../engine/ActionRegistry.js';
import { registerEngineActions } from '../../engine/EngineActions.js';
import { gamePhase, playerId, type BaseGameSnapshot, type PlayerId } from '../../engine/types.js';
import { SceneManager } from '../SceneManager.js';
import { SceneRegistry, sceneId, type SceneDescriptor } from '../SceneRegistry.js';

const HOST = playerId('host');
const CLIENT = playerId('client');
const RESULT = { winnerIds: [HOST] };

function makeSnapshot(overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 99,
        players: { [HOST]: { id: HOST }, [CLIENT]: { id: CLIENT } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: HOST,
        timers: {},
        gameResult: null,
        sceneId: sceneId('engine:game'),
        sceneTransition: null,
        ...overrides,
    };
}

function makeDescriptor(
    rawSceneId: string,
    overrides: Partial<SceneDescriptor<BaseGameSnapshot>> = {},
): SceneDescriptor<BaseGameSnapshot> {
    return {
        sceneId: sceneId(rawSceneId),
        defaultScreen: 'playfield',
        requiredAssets: [],
        initialize: (state) => state,
        ...overrides,
    };
}

function makePipeline(
    descriptors: readonly SceneDescriptor<BaseGameSnapshot>[],
    gameId?: string,
): ActionPipeline<BaseGameSnapshot> {
    const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
    for (const descriptor of descriptors) {
        sceneRegistry.register(descriptor);
    }
    const actionRegistry = new ActionRegistry<BaseGameSnapshot>();
    registerEngineActions(actionRegistry);
    // A registered gameplay action, so "gameplay is still refused" is measured
    // at the terminal gate rather than at stage 1's unknown-type rejection —
    // which would pass for a reason that has nothing to do with the match
    // being resolved.
    actionRegistry.register({
        type: 'game:move',
        parsePayload: () => ({}),
        validate: () => ({ ok: true }) as const,
        reduce: (state) => ({ ...state, tick: state.tick + 1 }),
    });
    new SceneManager(sceneRegistry).registerActions(actionRegistry);
    return gameId === undefined
        ? new ActionPipeline(actionRegistry)
        : new ActionPipeline(actionRegistry, { gameId });
}

function action(
    type: string,
    snapshot: BaseGameSnapshot,
    dispatcher: PlayerId,
    payload: Record<string, unknown> = {},
) {
    return { type, playerId: dispatcher, tick: snapshot.tick, payload };
}

/**
 * The refusal REASON a dispatch produced, so a case asserts why it was refused
 * and not merely that something threw — a rejection for a different reason is
 * a different measurement.
 */
function reasonOf(dispatch: () => unknown): string {
    try {
        dispatch();
    } catch (error: unknown) {
        return error instanceof ActionUnauthorizedError
            ? (error.reason ?? 'rejected with no reason')
            : `threw ${String(error)}`;
    }
    return 'applied';
}

/** A transition prepared and pending, with the match resolved under it. */
function preparedThenResolved(
    pipeline: ActionPipeline<BaseGameSnapshot>,
    to = 'post-game',
): BaseGameSnapshot {
    const base = makeSnapshot();
    const prepared = pipeline.process(
        base,
        action('engine:scene_prepare', base, HOST, { toSceneId: to }),
    );
    return { ...prepared, phase: gamePhase('ended'), gameResult: RESULT };
}

describe('a scene transition in flight when the match resolves', () => {
    it('can be finished by the acks and the commit the terminal gate now admits', () => {
        const pipeline = makePipeline([makeDescriptor('engine:game'), makeDescriptor('post-game')]);
        const resolved = preparedThenResolved(pipeline);
        expect(resolved.sceneTransition).not.toBeNull();

        const hostReady = pipeline.process(
            resolved,
            action('engine:scene_ready', resolved, HOST, { playerId: HOST }),
        );
        const bothReady = pipeline.process(
            hostReady,
            action('engine:scene_ready', hostReady, CLIENT, { playerId: CLIENT }),
        );
        expect(bothReady.sceneTransition?.phase).toBe('ready');

        const committed = pipeline.process(
            bothReady,
            action('engine:scene_commit', bothReady, HOST),
        );

        expect(committed.sceneTransition).toBeNull();
        expect(committed.sceneId).toBe(sceneId('post-game'));
        // The result the gate exists to protect is carried through untouched.
        expect(committed.gameResult).toEqual(RESULT);
        expect(committed.phase).toBe(gamePhase('ended'));
    });

    it('still refuses to START another transition', () => {
        // The other side of the line, so the admitted set is a door and not a
        // hole: a resolved match may finish the transition it is in and may not
        // begin one.
        const pipeline = makePipeline([makeDescriptor('engine:game'), makeDescriptor('post-game')]);
        const resolved = makeSnapshot({ phase: gamePhase('ended'), gameResult: RESULT });

        let caught: unknown;
        try {
            pipeline.process(
                resolved,
                action('engine:scene_prepare', resolved, HOST, { toSceneId: 'post-game' }),
            );
        } catch (error: unknown) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(ActionUnauthorizedError);
        expect((caught as ActionUnauthorizedError).reason).toBe('match_already_resolved');
    });

    it('can be dropped by the host when the descriptor’s policy is drop', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            makeDescriptor('post-game', { timeoutTicks: 0, onClientTimeout: 'drop' }),
        ]);
        const resolved = preparedThenResolved(pipeline);

        const dropped = pipeline.process(resolved, action('engine:scene_drop', resolved, HOST));

        expect(dropped.sceneTransition).toBeNull();
        expect(dropped.sceneId).toBe(sceneId('engine:game'));
        expect(dropped.gameResult).toEqual(RESULT);
    });

    it('cannot be un-resolved by the entered scene’s initialize', () => {
        // The door the admitted commit opens, and the one thing it must not
        // carry through. `initialize` may return any state, and the commit
        // spreads it — so a descriptor that blanks `gameResult` would rewrite a
        // recorded result, the resolver would re-run on a null field, and
        // gameplay would flow again into a match the engine calls finished.
        // Before the gate admitted the commit this path was unreachable.
        const pipeline = makePipeline(
            [
                makeDescriptor('engine:game'),
                makeDescriptor('post-game', {
                    initialize: (state) => ({
                        ...state,
                        gameResult: null,
                        phase: gamePhase('playing'),
                    }),
                }),
            ],
            'test-game',
        );
        const resolved = preparedThenResolved(pipeline);
        const hostReady = pipeline.process(
            resolved,
            action('engine:scene_ready', resolved, HOST, { playerId: HOST }),
        );
        const bothReady = pipeline.process(
            hostReady,
            action('engine:scene_ready', hostReady, CLIENT, { playerId: CLIENT }),
        );

        const committed = pipeline.process(
            bothReady,
            action('engine:scene_commit', bothReady, HOST),
        );

        expect(committed.gameResult).toEqual(RESULT);
        // The descriptor's `phase` write SURVIVES — only the result is re-pinned,
        // because that is what the terminal gate and the resolver key on.
        expect(committed.phase).toBe(gamePhase('playing'));
        // Which is why the consequence is asserted rather than the phase: the
        // match stays shut on the recorded result alone, with `phase` reading
        // whatever the entered scene wrote.
        expect(
            reasonOf(() => pipeline.process(committed, action('game:move', committed, HOST))),
        ).toBe('match_already_resolved');
    });

    it('still lets an entered scene RESOLVE a match that was not resolved yet', () => {
        // The other direction across the same spread, and the reason the
        // carry-through above is conditional rather than unconditional: a scene
        // whose `initialize` ENDS the match is a legitimate way to resolve one,
        // and re-pinning the prior state's fields on every commit would silently
        // discard it.
        const pipeline = makePipeline(
            [
                makeDescriptor('engine:game'),
                makeDescriptor('post-game', {
                    initialize: (state) => ({
                        ...state,
                        gameResult: { winnerIds: [CLIENT] },
                        phase: gamePhase('ended'),
                    }),
                }),
            ],
            'test-game',
        );

        // No result recorded when the transition starts — the match is live.
        const base = makeSnapshot();
        const prepared = pipeline.process(
            base,
            action('engine:scene_prepare', base, HOST, { toSceneId: 'post-game' }),
        );
        const hostReady = pipeline.process(
            prepared,
            action('engine:scene_ready', prepared, HOST, { playerId: HOST }),
        );
        const bothReady = pipeline.process(
            hostReady,
            action('engine:scene_ready', hostReady, CLIENT, { playerId: CLIENT }),
        );

        const committed = pipeline.process(
            bothReady,
            action('engine:scene_commit', bothReady, HOST),
        );

        expect(committed.gameResult).toEqual({ winnerIds: [CLIENT] });
        expect(committed.phase).toBe(gamePhase('ended'));
    });

    it('is NOT released by the admitted set when a seat cannot ack — that exit is return_to_lobby', () => {
        // The limit of this change, measured rather than asserted. Admitting the
        // three completing actions releases the barrier only once EVERY seat in
        // `state.players` acks: `engine:scene_ready` has one producer and it
        // runs inside a mounted `SceneRouter`, so an AI seat or a disconnected
        // one never acks. The timeout arm cannot cover for it either — it is
        // counted in ticks, and `engine:tick` stays refused after a result.
        //
        // So a seat that cannot ack still holds the transition, exactly as
        // before. What ends it is `engine:return_to_lobby`, which the gate
        // admitted before this change too.
        //
        // The DEFAULT descriptor, deliberately: a scene declaring
        // `timeoutTicks: 0` with policy `drop` is released by the admitted drop
        // on its first tick, which is the case above and the opposite of this
        // one. Every refusal below is asserted by REASON, so a fixture that
        // stopped exhibiting the hold would red here rather than pass for a new
        // reason.
        const pipeline = makePipeline([makeDescriptor('engine:game'), makeDescriptor('post-game')]);
        const resolved = preparedThenResolved(pipeline);
        const hostOnly = pipeline.process(
            resolved,
            action('engine:scene_ready', resolved, HOST, { playerId: HOST }),
        );
        expect(hostOnly.sceneTransition?.phase).toBe('preparing');

        // The commit refuses: the seat that cannot ack is not ready.
        expect(
            reasonOf(() =>
                pipeline.process(hostOnly, action('engine:scene_commit', hostOnly, HOST)),
            ),
        ).toBe('players_not_ready');
        // The drop refuses because the transition has not timed out — and it
        // cannot, since `timeoutTicks` defaults to 1800 and the tick has moved
        // by 2.
        expect(
            reasonOf(() => pipeline.process(hostOnly, action('engine:scene_drop', hostOnly, HOST))),
        ).toBe('transition_not_timed_out');
        expect(hostOnly.sceneTransition?.timeoutTicks).toBe(1_800);
        expect(hostOnly.tick - (hostOnly.sceneTransition?.startedAtTick ?? -1)).toBe(2);
        // And nothing can advance it toward that timeout: the one action whose
        // purpose is advancing the tick stays refused after a result.
        expect(
            reasonOf(() =>
                pipeline.process(hostOnly, action('engine:tick', hostOnly, HOST, { seed: 1 })),
            ),
        ).toBe('match_already_resolved');

        // The exit that does work, and predates this change.
        const lobby = pipeline.process(hostOnly, action('engine:return_to_lobby', hostOnly, HOST));
        expect(lobby.sceneTransition).toBeNull();
    });
});
