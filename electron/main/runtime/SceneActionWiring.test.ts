import { describe, expect, it } from 'vitest';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import {
    gamePhase,
    playerId,
    type BaseGameSnapshot,
    type GameReduceContext,
    type PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { sceneId, type SceneRegistry } from '@chimera-engine/simulation/scene/index.js';
import type { MainGameContribution } from '../game/mainGameRegistry.js';
import { wireDefaultSceneActions } from './SceneActionWiring.js';

const HOST: PlayerId = playerId('host');

/** Minimal host-owned snapshot — `engine:scene_prepare` validates against it. */
function makeSnapshot(): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 1,
        players: { [HOST]: { id: HOST } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: HOST,
        timers: {},
        gameResult: null,
        sceneId: sceneId('engine:game'),
        sceneTransition: null,
    };
}

/**
 * Whether the wired `SceneManager` can transition INTO `id`.
 *
 * Read through `engine:scene_prepare`'s own `validate`, because the
 * `SceneRegistry` is a local that never escapes `wireDefaultSceneActions` —
 * this is the only channel a caller has for asking what it holds, and it is the
 * channel production uses. An unregistered scene answers `unknown_scene`.
 */
function canEnterScene(registry: ActionRegistry, rawSceneId: string): boolean {
    const prepare = registry.resolve('engine:scene_prepare');
    // `engine:scene_prepare.validate` reads only payload, state and dispatcher;
    // the context is required by the signature and unused on this path.
    const result = prepare.validate(
        { toSceneId: rawSceneId, params: {} },
        makeSnapshot(),
        HOST,
        {} as GameReduceContext,
    );
    return result.ok;
}

/** A contribution carrying only the fields this wiring reads. */
type SceneContribution = Pick<MainGameContribution, 'registerScenes'>;

function contributionRegistering(rawSceneId: string, order?: string[]): SceneContribution {
    return {
        registerScenes: (sceneRegistry: SceneRegistry<BaseGameSnapshot>) => {
            order?.push(rawSceneId);
            sceneRegistry.register({
                sceneId: sceneId(rawSceneId),
                defaultScreen: 'playfield',
                requiredAssets: [],
                initialize: (state) => state,
            });
        },
    };
}

describe('wireDefaultSceneActions', () => {
    it('registers the scene prepare, ready, and commit engine actions', () => {
        const registry = new ActionRegistry();

        wireDefaultSceneActions(registry);

        expect(registry.has('engine:scene_prepare')).toBe(true);
        expect(registry.has('engine:scene_ready')).toBe(true);
        expect(registry.has('engine:scene_commit')).toBe(true);
    });

    it('hands each contribution the registry, and its scene resolves afterwards', () => {
        const registry = new ActionRegistry();

        wireDefaultSceneActions(registry, [contributionRegistering('demo:one')]);

        expect(canEnterScene(registry, 'demo:one')).toBe(true);
    });

    it('registers two contributions, in the order they were given', () => {
        const registry = new ActionRegistry();
        const order: string[] = [];

        wireDefaultSceneActions(registry, [
            contributionRegistering('demo:first', order),
            contributionRegistering('demo:second', order),
        ]);

        expect(order).toEqual(['demo:first', 'demo:second']);
        expect(canEnterScene(registry, 'demo:first')).toBe(true);
        expect(canEnterScene(registry, 'demo:second')).toBe(true);
    });

    it('treats a contribution without the hook as a silent no-op', () => {
        const registry = new ActionRegistry();
        const withoutHook: SceneContribution = {};

        expect(() => {
            wireDefaultSceneActions(registry, [withoutHook, contributionRegistering('demo:after')]);
        }).not.toThrow();

        // The hookless contribution must not swallow the ones after it either.
        expect(canEnterScene(registry, 'demo:after')).toBe(true);
    });

    it('registers the default engine scenes when the contribution list is empty', () => {
        const registry = new ActionRegistry();

        wireDefaultSceneActions(registry, []);

        expect(canEnterScene(registry, 'engine:lobby')).toBe(true);
        expect(canEnterScene(registry, 'engine:post-game')).toBe(true);
    });

    it('registers the default engine scenes when the argument is omitted entirely', () => {
        // The parameter stays optional so the no-contributions call above keeps
        // compiling — the arity is the contract, not just the behaviour.
        const registry = new ActionRegistry();

        wireDefaultSceneActions(registry);

        expect(canEnterScene(registry, 'engine:lobby')).toBe(true);
        expect(canEnterScene(registry, 'engine:post-game')).toBe(true);
    });

    it('registers the default engine scenes alongside a contributed one', () => {
        // Separate from the cases above: replacing `registerDefaultScenes` with
        // the contribution loop leaves both of them green on their own.
        const registry = new ActionRegistry();

        wireDefaultSceneActions(registry, [contributionRegistering('demo:only')]);

        expect(canEnterScene(registry, 'engine:lobby')).toBe(true);
        expect(canEnterScene(registry, 'engine:post-game')).toBe(true);
        expect(canEnterScene(registry, 'demo:only')).toBe(true);
    });

    it('does not let an unregistered scene pass', () => {
        // Positive control for `canEnterScene`: without it, every assertion
        // above would hold against a validate() that answered `ok` regardless.
        const registry = new ActionRegistry();

        wireDefaultSceneActions(registry, [contributionRegistering('demo:one')]);

        expect(canEnterScene(registry, 'demo:never-registered')).toBe(false);
    });
});
