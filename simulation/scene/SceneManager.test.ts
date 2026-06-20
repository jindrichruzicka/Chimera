import { describe, expect, it, vi } from 'vitest';
import { ActionRegistry } from '../engine/ActionRegistry.js';
import { ActionPipeline, ActionUnauthorizedError } from '../engine/ActionPipeline.js';
import { registerEngineActions } from '../engine/EngineActions.js';
import {
    gamePhase,
    playerId,
    type BaseGameSnapshot,
    type GameReduceContext,
    type PlayerId,
} from '../engine/types.js';
import { SceneManager } from './SceneManager.js';
import { SceneRegistry, sceneId, type SceneDescriptor } from './SceneRegistry.js';

const HOST = playerId('host');
const CLIENT = playerId('client');

function makeSnapshot(overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 99,
        players: {
            [HOST]: { id: HOST },
            [CLIENT]: { id: CLIENT },
        },
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

function makePipeline(
    descriptors: readonly SceneDescriptor<BaseGameSnapshot>[],
): ActionPipeline<BaseGameSnapshot> {
    const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
    for (const descriptor of descriptors) {
        sceneRegistry.register(descriptor);
    }
    const sceneManager = new SceneManager(sceneRegistry);
    const actionRegistry = new ActionRegistry<BaseGameSnapshot>();
    registerEngineActions(actionRegistry);
    sceneManager.registerActions(actionRegistry);
    return new ActionPipeline(actionRegistry);
}

function action(
    type:
        | 'engine:scene_prepare'
        | 'engine:scene_ready'
        | 'engine:scene_commit'
        | 'engine:scene_drop',
    snapshot: BaseGameSnapshot,
    playerIdForAction: PlayerId,
    payload: Record<string, unknown>,
) {
    return {
        type,
        playerId: playerIdForAction,
        tick: snapshot.tick,
        payload,
    };
}

describe('SceneManager action definitions', () => {
    it('runs the full prepare -> ready -> commit round-trip through ActionPipeline', () => {
        const calls: string[] = [];
        const current: SceneDescriptor<BaseGameSnapshot> = {
            sceneId: sceneId('engine:game'),
            defaultScreen: 'board',
            requiredAssets: [],
            initialize(state) {
                return state;
            },
            teardown(state, ctx) {
                calls.push(`teardown:${state.sceneId}:${ctx.dispatchDepth}`);
                return { ...state, events: [...state.events, { type: 'scene:teardown' }] };
            },
        };
        const next: SceneDescriptor<BaseGameSnapshot> = {
            sceneId: sceneId('engine:post-game'),
            defaultScreen: 'board',
            requiredAssets: [],
            initialize(state, params, ctx) {
                calls.push(`initialize:${String(params['reason'])}:${ctx.dispatchDepth}`);
                return { ...state, events: [...state.events, { type: 'scene:initialize' }] };
            },
        };
        const pipeline = makePipeline([current, next]);

        const prepared = pipeline.process(
            makeSnapshot(),
            action('engine:scene_prepare', makeSnapshot(), HOST, {
                toSceneId: 'engine:post-game',
                params: { reason: 'victory' },
            }),
        );

        expect(prepared.tick).toBe(1);
        expect(prepared.sceneId).toBe(sceneId('engine:game'));
        expect(prepared.sceneTransition).toEqual({
            toSceneId: sceneId('engine:post-game'),
            phase: 'preparing',
            startedAtTick: 0,
            params: { reason: 'victory' },
            playersReady: [],
            timeoutTicks: 1_800,
            onClientTimeout: 'proceed',
        });

        const hostReady = pipeline.process(
            prepared,
            action('engine:scene_ready', prepared, HOST, { playerId: HOST }),
        );
        expect(hostReady.tick).toBe(2);
        expect(hostReady.sceneTransition?.phase).toBe('preparing');
        expect(hostReady.sceneTransition?.playersReady).toEqual([HOST]);

        const allReady = pipeline.process(
            hostReady,
            action('engine:scene_ready', hostReady, CLIENT, { playerId: CLIENT }),
        );
        expect(allReady.tick).toBe(3);
        expect(allReady.sceneTransition?.phase).toBe('ready');
        expect(allReady.sceneTransition?.playersReady).toEqual([HOST, CLIENT]);

        const committed = pipeline.process(
            allReady,
            action('engine:scene_commit', allReady, HOST, {}),
        );

        expect(committed.tick).toBe(4);
        expect(committed.sceneId).toBe(sceneId('engine:post-game'));
        expect(committed.sceneTransition).toBeNull();
        expect(committed.events.map((event) => event.type)).toEqual([
            'scene:teardown',
            'scene:initialize',
        ]);
        expect(calls).toEqual(['teardown:engine:game:0', 'initialize:victory:0']);
    });

    it('rejects scene_prepare from non-host players', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            makeDescriptor('engine:next'),
        ]);
        const snapshot = makeSnapshot();

        expect(() =>
            pipeline.process(
                snapshot,
                action('engine:scene_prepare', snapshot, CLIENT, { toSceneId: 'engine:next' }),
            ),
        ).toThrow(ActionUnauthorizedError);
    });

    it('rejects scene_commit before every player acknowledges readiness', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            makeDescriptor('engine:next'),
        ]);
        const prepared = pipeline.process(
            makeSnapshot(),
            action('engine:scene_prepare', makeSnapshot(), HOST, { toSceneId: 'engine:next' }),
        );

        expect(() =>
            pipeline.process(prepared, action('engine:scene_commit', prepared, HOST, {})),
        ).toThrow(ActionUnauthorizedError);
    });

    it('rejects duplicate scene_ready acknowledgements', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            makeDescriptor('engine:next'),
        ]);
        const prepared = pipeline.process(
            makeSnapshot(),
            action('engine:scene_prepare', makeSnapshot(), HOST, { toSceneId: 'engine:next' }),
        );
        const ready = pipeline.process(
            prepared,
            action('engine:scene_ready', prepared, HOST, { playerId: HOST }),
        );

        expect(() =>
            pipeline.process(ready, action('engine:scene_ready', ready, HOST, { playerId: HOST })),
        ).toThrow(ActionUnauthorizedError);
    });

    it('copies timeout policy from target SceneDescriptor into sceneTransition during prepare', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            {
                ...makeDescriptor('engine:next'),
                timeoutTicks: 4_000,
                onClientTimeout: 'drop',
            },
        ]);
        const snapshot = makeSnapshot();

        const prepared = pipeline.process(
            snapshot,
            action('engine:scene_prepare', snapshot, HOST, { toSceneId: 'engine:next' }),
        );

        expect(prepared.sceneTransition).toMatchObject({
            timeoutTicks: 4_000,
            onClientTimeout: 'drop',
        });
    });

    it('applies default timeout policy when SceneDescriptor omits timeout settings', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            makeDescriptor('engine:next'),
        ]);
        const snapshot = makeSnapshot();

        const prepared = pipeline.process(
            snapshot,
            action('engine:scene_prepare', snapshot, HOST, { toSceneId: 'engine:next' }),
        );

        expect(prepared.sceneTransition).toMatchObject({
            timeoutTicks: 1_800,
            onClientTimeout: 'proceed',
        });
    });

    it('allows scene_commit after timeout when onClientTimeout is proceed', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            {
                ...makeDescriptor('engine:next'),
                timeoutTicks: 2,
                onClientTimeout: 'proceed',
            },
        ]);

        const prepared = pipeline.process(
            makeSnapshot({ players: { [HOST]: { id: HOST }, [CLIENT]: { id: CLIENT } } }),
            action(
                'engine:scene_prepare',
                makeSnapshot({ players: { [HOST]: { id: HOST }, [CLIENT]: { id: CLIENT } } }),
                HOST,
                { toSceneId: 'engine:next' },
            ),
        );
        const timedOut = { ...prepared, tick: prepared.tick + 2 };

        const committed = pipeline.process(
            timedOut,
            action('engine:scene_commit', timedOut, HOST, {}),
        );

        expect(committed.sceneId).toBe(sceneId('engine:next'));
        expect(committed.sceneTransition).toBeNull();
    });

    it('supports dropping a timed-out scene transition via engine:scene_drop when onClientTimeout is drop', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            {
                ...makeDescriptor('engine:next'),
                timeoutTicks: 2,
                onClientTimeout: 'drop',
            },
        ]);

        const prepared = pipeline.process(
            makeSnapshot(),
            action('engine:scene_prepare', makeSnapshot(), HOST, { toSceneId: 'engine:next' }),
        );
        const timedOut = { ...prepared, tick: prepared.tick + 2 };

        const dropped = pipeline.process(timedOut, action('engine:scene_drop', timedOut, HOST, {}));

        expect(dropped.sceneId).toBe(sceneId('engine:game'));
        expect(dropped.sceneTransition).toBeNull();
    });

    it('passes a frozen context to descriptor teardown and initialize hooks', () => {
        const mutationAttempts = vi.fn();
        const current: SceneDescriptor<BaseGameSnapshot> = {
            sceneId: sceneId('engine:game'),
            defaultScreen: 'board',
            requiredAssets: [],
            initialize(state) {
                return state;
            },
            teardown(state, ctx) {
                assertFrozenContext(ctx, mutationAttempts);
                return state;
            },
        };
        const next: SceneDescriptor<BaseGameSnapshot> = {
            sceneId: sceneId('engine:next'),
            defaultScreen: 'board',
            requiredAssets: [],
            initialize(state, _params, ctx) {
                assertFrozenContext(ctx, mutationAttempts);
                return state;
            },
        };
        const pipeline = makePipeline([current, next]);
        const prepared = pipeline.process(
            makeSnapshot({ players: { [HOST]: { id: HOST } } }),
            action(
                'engine:scene_prepare',
                makeSnapshot({ players: { [HOST]: { id: HOST } } }),
                HOST,
                {
                    toSceneId: 'engine:next',
                },
            ),
        );
        const ready = pipeline.process(
            prepared,
            action('engine:scene_ready', prepared, HOST, { playerId: HOST }),
        );

        pipeline.process(ready, action('engine:scene_commit', ready, HOST, {}));

        expect(mutationAttempts).toHaveBeenCalledTimes(2);
    });
});

function makeDescriptor(rawSceneId: string): SceneDescriptor<BaseGameSnapshot> {
    return {
        sceneId: sceneId(rawSceneId),
        defaultScreen: 'board',
        requiredAssets: [],
        initialize(state) {
            return state;
        },
    };
}

function assertFrozenContext(ctx: GameReduceContext, mutationAttempts: () => void): void {
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(() => {
        (ctx as { dispatchDepth: number }).dispatchDepth = 99;
    }).toThrow(TypeError);
    expect(ctx.rng).toBeDefined();
    mutationAttempts();
}
