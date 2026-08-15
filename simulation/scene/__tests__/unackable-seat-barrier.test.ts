// simulation/scene/__tests__/unackable-seat-barrier.test.ts
//
// A scene transition where one seat never acknowledges — an AI seat, or a
// player whose renderer is gone — driven through the real `ActionPipeline`.
//
// The barrier requires an ack from every key of `state.players`, and
// `engine:scene_ready` has exactly one producer: `useFadeTransition`, inside a
// mounted `SceneRouter`. A seat with no renderer therefore never acks. The
// transition's own timeout cannot cover for it either, because it is counted in
// TICKS and only an applied action advances one — in a turn-based match nothing
// does.
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
/** The seat that never acks: an AI seat has no renderer to produce one. */
const AI_SEAT = playerId('ai-1');

function makeSnapshot(overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 99,
        players: { [HOST]: { id: HOST }, [AI_SEAT]: { id: AI_SEAT } },
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
): ActionPipeline<BaseGameSnapshot> {
    const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
    for (const descriptor of descriptors) {
        sceneRegistry.register(descriptor);
    }
    const actionRegistry = new ActionRegistry<BaseGameSnapshot>();
    registerEngineActions(actionRegistry);
    new SceneManager(sceneRegistry).registerActions(actionRegistry);
    return new ActionPipeline(actionRegistry);
}

function action(
    type: string,
    snapshot: BaseGameSnapshot,
    dispatcher: PlayerId,
    payload: Record<string, unknown> = {},
) {
    return { type, playerId: dispatcher, tick: snapshot.tick, payload };
}

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

/** Prepared, with only the host acking — the AI seat never will. */
function pendingOnTheAiSeat(
    pipeline: ActionPipeline<BaseGameSnapshot>,
    to = 'post-game',
): BaseGameSnapshot {
    const base = makeSnapshot();
    const prepared = pipeline.process(
        base,
        action('engine:scene_prepare', base, HOST, { toSceneId: to }),
    );
    return pipeline.process(
        prepared,
        action('engine:scene_ready', prepared, HOST, { playerId: HOST }),
    );
}

describe('a scene transition holding on a seat that cannot acknowledge', () => {
    it('is held by the tick-denominated timeout alone, which nothing advances', () => {
        // The stall itself, so the release below is measured against a state
        // that is genuinely stuck rather than one that would have resolved.
        const pipeline = makePipeline([makeDescriptor('engine:game'), makeDescriptor('post-game')]);
        const pending = pendingOnTheAiSeat(pipeline);

        expect(pending.sceneTransition?.phase).toBe('preparing');
        expect(pending.sceneTransition?.playersReady).toEqual([HOST]);
        expect(
            reasonOf(() => pipeline.process(pending, action('engine:scene_commit', pending, HOST))),
        ).toBe('players_not_ready');
        expect(
            reasonOf(() => pipeline.process(pending, action('engine:scene_drop', pending, HOST))),
        ).toBe('transition_not_timed_out');
        // 1800 ticks away, and a turn-based match applies no action that would
        // close the gap.
        expect(pending.sceneTransition?.timeoutTicks).toBe(1_800);
        expect(pending.tick - (pending.sceneTransition?.startedAtTick ?? -1)).toBe(2);
    });

    it('is released by a host-declared expiry, honouring a proceed policy', () => {
        // The host owns a wall clock; the reduce does not. `engine:scene_expire`
        // is how the host says its budget elapsed, and the descriptor's own
        // policy still decides what that means — here, commit anyway.
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            makeDescriptor('post-game', { onClientTimeout: 'proceed' }),
        ]);
        const pending = pendingOnTheAiSeat(pipeline);

        const expired = pipeline.process(pending, action('engine:scene_expire', pending, HOST));
        expect(expired.sceneTransition?.expired).toBe(true);
        // Nothing else about the transition moves — the acks it collected stand.
        expect(expired.sceneTransition?.playersReady).toEqual([HOST]);

        const committed = pipeline.process(expired, action('engine:scene_commit', expired, HOST));

        expect(committed.sceneTransition).toBeNull();
        expect(committed.sceneId).toBe(sceneId('post-game'));
    });

    it('is released by the same expiry into a DROP policy, back to the current scene', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            makeDescriptor('post-game', { onClientTimeout: 'drop' }),
        ]);
        const pending = pendingOnTheAiSeat(pipeline);
        const expired = pipeline.process(pending, action('engine:scene_expire', pending, HOST));

        // A commit is REFUSED under this policy, which is what makes the drop
        // the policy's outcome rather than a second way to reach the same one.
        expect(
            reasonOf(() => pipeline.process(expired, action('engine:scene_commit', expired, HOST))),
        ).toBe('transition_timed_out_drop');

        const dropped = pipeline.process(expired, action('engine:scene_drop', expired, HOST));

        expect(dropped.sceneTransition).toBeNull();
        expect(dropped.sceneId).toBe(sceneId('engine:game'));
    });

    it('refuses the expiry from a client, and when no transition is pending', () => {
        // It ends a barrier every other seat is waiting on, so it is as
        // host-only as the prepare that started it.
        const pipeline = makePipeline([makeDescriptor('engine:game'), makeDescriptor('post-game')]);
        const pending = pendingOnTheAiSeat(pipeline);

        expect(
            reasonOf(() =>
                pipeline.process(pending, action('engine:scene_expire', pending, AI_SEAT)),
            ),
        ).toBe('host_only');

        const idle = makeSnapshot();
        expect(
            reasonOf(() => pipeline.process(idle, action('engine:scene_expire', idle, HOST))),
        ).toBe('no_transition');
    });

    it('refuses a second expiry, so the tick it costs is spent once', () => {
        const pipeline = makePipeline([makeDescriptor('engine:game'), makeDescriptor('post-game')]);
        const expired = (() => {
            const pending = pendingOnTheAiSeat(pipeline);
            return pipeline.process(pending, action('engine:scene_expire', pending, HOST));
        })();

        expect(
            reasonOf(() => pipeline.process(expired, action('engine:scene_expire', expired, HOST))),
        ).toBe('already_expired');
    });

    it('is admitted after the match resolves, like the commit and drop it unblocks', () => {
        // A transition can be pending when a result lands, and the terminal
        // gate admits what finishes one. The expiry is what
        // makes the commit or drop reachable for a seat that cannot ack, so
        // refusing it there would strand exactly the transitions those two were
        // admitted to finish.
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            makeDescriptor('post-game', { onClientTimeout: 'proceed' }),
        ]);
        const pending = pendingOnTheAiSeat(pipeline);
        const resolved: BaseGameSnapshot = {
            ...pending,
            phase: gamePhase('ended'),
            gameResult: { winnerIds: [HOST] },
        };

        const expired = pipeline.process(resolved, action('engine:scene_expire', resolved, HOST));
        expect(expired.sceneTransition?.expired).toBe(true);

        const committed = pipeline.process(expired, action('engine:scene_commit', expired, HOST));
        expect(committed.sceneTransition).toBeNull();
        expect(committed.gameResult).toEqual({ winnerIds: [HOST] });
    });

    it('carries nothing on the ack that the expiry could have travelled on instead', () => {
        // Invariant #133 rests on no client load timing entering authoritative
        // state. The release added here is the HOST's, so the ack's payload is
        // unchanged — re-asserted at this tree because a barrier change is
        // exactly when it would be tempting to widen it.
        const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
        sceneRegistry.register(makeDescriptor('engine:game'));
        const registry = new ActionRegistry<BaseGameSnapshot>();
        new SceneManager(sceneRegistry).registerActions(registry);

        const parsed = registry.resolve('engine:scene_ready').parsePayload({
            playerId: 'host',
            loadedFraction: 0.5,
            outcome: 'loaded',
        });

        expect(parsed).toEqual({ playerId: HOST });
        expect(Object.keys(parsed)).toEqual(['playerId']);
        // And the expiry itself carries no payload at all. Asserted by handing
        // it one: an identity parser satisfies the empty case, so only a
        // REJECTED non-empty payload measures the guard that keeps a client's
        // load out of the one action the host sends about the wait.
        expect(registry.resolve('engine:scene_expire').parsePayload({})).toEqual({});
        expect(() =>
            registry.resolve('engine:scene_expire').parsePayload({ loadedFraction: 0.5 }),
        ).toThrow(TypeError);
    });
});
