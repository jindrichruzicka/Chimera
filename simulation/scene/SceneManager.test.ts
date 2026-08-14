import { describe, expect, it, vi } from 'vitest';
import { ActionRegistry } from '../engine/ActionRegistry.js';
import { ActionPipeline, ActionUnauthorizedError } from '../engine/ActionPipeline.js';
import { buildAssetRef, type AssetRef } from '../content/AssetRef.js';
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

function makeActionRegistry(
    descriptors: readonly SceneDescriptor<BaseGameSnapshot>[],
): ActionRegistry<BaseGameSnapshot> {
    const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
    for (const descriptor of descriptors) {
        sceneRegistry.register(descriptor);
    }
    const sceneManager = new SceneManager(sceneRegistry);
    const actionRegistry = new ActionRegistry<BaseGameSnapshot>();
    registerEngineActions(actionRegistry);
    sceneManager.registerActions(actionRegistry);
    return actionRegistry;
}

function makePipeline(
    descriptors: readonly SceneDescriptor<BaseGameSnapshot>[],
): ActionPipeline<BaseGameSnapshot> {
    return new ActionPipeline(makeActionRegistry(descriptors));
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
            defaultScreen: 'playfield',
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
            defaultScreen: 'playfield',
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
        // A whole-object assertion, so an added field is a red rather than a
        // silent widening.
        expect(prepared.sceneTransition).toEqual({
            toSceneId: sceneId('engine:post-game'),
            phase: 'preparing',
            startedAtTick: 0,
            params: { reason: 'victory' },
            playersReady: [],
            timeoutTicks: 1_800,
            onClientTimeout: 'proceed',
            defaultScreen: 'playfield',
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
            defaultScreen: 'playfield',
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
            defaultScreen: 'playfield',
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

describe('SceneManager required-asset carriage', () => {
    const BACKDROP = buildAssetRef('texture', 'engine/scene/backdrop.webp');
    const RIG = buildAssetRef('gltf-model', 'engine/scene/rig.glb');

    function declaring(
        rawSceneId: string,
        requiredAssets: readonly AssetRef[],
    ): SceneDescriptor<BaseGameSnapshot> {
        return { ...makeDescriptor(rawSceneId), requiredAssets };
    }

    /** prepare → ready(host) → commit, for a snapshot whose only player is the host. */
    function transitionTo(
        pipeline: ActionPipeline<BaseGameSnapshot>,
        state: BaseGameSnapshot,
        rawSceneId: string,
    ): BaseGameSnapshot {
        const prepared = pipeline.process(
            state,
            action('engine:scene_prepare', state, HOST, { toSceneId: rawSceneId }),
        );
        const ready = pipeline.process(
            prepared,
            action('engine:scene_ready', prepared, HOST, { playerId: HOST }),
        );
        return pipeline.process(ready, action('engine:scene_commit', ready, HOST, {}));
    }

    it('carries the target scene declared refs onto the pending transition verbatim', () => {
        // Declared out of alphabetical order and holding a repeat: a reducer
        // that sorted, de-duplicated or re-mapped the refs on the way through
        // would satisfy a set-shaped assertion and fails this one.
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            declaring('engine:next', [RIG, BACKDROP, RIG]),
        ]);
        const snapshot = makeSnapshot();

        const prepared = pipeline.process(
            snapshot,
            action('engine:scene_prepare', snapshot, HOST, { toSceneId: 'engine:next' }),
        );

        expect(prepared.sceneTransition?.requiredAssets).toEqual([RIG, BACKDROP, RIG]);
    });

    it('carries the target scene default screen onto the pending transition', () => {
        // The screen key is declared ONCE, on the descriptor, and the host holds
        // the registry. Without this the renderer can only guess the entering
        // scene's screen from its own `sceneDefaultScreens` map, which a game
        // registering a scene has no reason to also populate — so the scene's
        // declared loading cover was silently replaced by `'playfield'`'s.
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            { ...makeDescriptor('engine:next'), defaultScreen: 'arena-hud' },
        ]);
        const snapshot = makeSnapshot();

        const prepared = pipeline.process(
            snapshot,
            action('engine:scene_prepare', snapshot, HOST, { toSceneId: 'engine:next' }),
        );

        expect(prepared.sceneTransition?.defaultScreen).toBe('arena-hud');
    });

    it('omits requiredAssets from the transition when the target scene declares none', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            makeDescriptor('engine:next'),
        ]);
        const snapshot = makeSnapshot();

        const prepared = pipeline.process(
            snapshot,
            action('engine:scene_prepare', snapshot, HOST, { toSceneId: 'engine:next' }),
        );

        // `Object.hasOwn`, not a value read: an emitted `requiredAssets: []`
        // reads as falsy-empty through the property and would leave the
        // omit-when-empty rule — which is what keeps the three engine scenes'
        // transition shape byte-identical — unpinned.
        expect(prepared.sceneTransition).not.toBeNull();
        expect(Object.hasOwn(prepared.sceneTransition ?? {}, 'requiredAssets')).toBe(false);
    });

    it('writes sceneRequiredAssets on every commit, so a scene declaring none inherits nothing', () => {
        const pipeline = makePipeline([
            makeDescriptor('engine:game'),
            declaring('engine:loaded', [BACKDROP, RIG]),
            makeDescriptor('engine:bare'),
        ]);
        const soloHost = makeSnapshot({ players: { [HOST]: { id: HOST } } });

        const loaded = transitionTo(pipeline, soloHost, 'engine:loaded');
        expect(loaded.sceneRequiredAssets).toEqual([BACKDROP, RIG]);

        // The second scene declares nothing. `initialize` spreads the prior
        // state, so a commit that omitted the empty array would leave the first
        // scene's refs standing on a scene that requires none.
        const bare = transitionTo(pipeline, loaded, 'engine:bare');
        expect(bare.sceneRequiredAssets).toEqual([]);
    });

    it('parses engine:scene_ready to exactly { playerId }, dropping every other key', () => {
        // The withheld field is the prohibition: no progress fraction, no
        // outcome and no ref list travels client → host on the ready ack.
        const registry = makeActionRegistry([makeDescriptor('engine:game')]);

        const parsed = registry.resolve('engine:scene_ready').parsePayload({
            playerId: 'host',
            requiredAssets: ['engine/scene/backdrop.webp'],
            loadedFraction: 0.5,
        });

        expect(parsed).toEqual({ playerId: HOST });
        expect(Object.keys(parsed)).toEqual(['playerId']);
    });
});

function makeDescriptor(rawSceneId: string): SceneDescriptor<BaseGameSnapshot> {
    return {
        sceneId: sceneId(rawSceneId),
        defaultScreen: 'playfield',
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
