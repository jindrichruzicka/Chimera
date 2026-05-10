import { describe, expect, it } from 'vitest';
import { buildAssetRef } from '@chimera/simulation/content/AssetRef.js';
import {
    gamePhase,
    playerId,
    type BaseGameSnapshot,
    type GameReduceContext,
} from '@chimera/simulation/engine/types.js';
import { makeStubRng } from '@chimera/simulation/engine/__test-support__/stubs.js';
import {
    DuplicateSceneRegistrationError,
    SceneRegistry,
    UnknownSceneError,
    sceneId,
    type SceneDescriptor,
} from './SceneRegistry.js';

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

describe('SceneRegistry', () => {
    it('resolves a registered scene descriptor by scene id', () => {
        const descriptor = makeDescriptor('engine:match');
        const registry = new SceneRegistry<BaseGameSnapshot>();

        registry.register(descriptor);

        expect(registry.resolve(sceneId('engine:match'))).toBe(descriptor);
        expect(registry.has(sceneId('engine:match'))).toBe(true);
    });

    it('throws on duplicate scene registration', () => {
        const registry = new SceneRegistry<BaseGameSnapshot>();
        registry.register(makeDescriptor('engine:match'));

        expect(() => registry.register(makeDescriptor('engine:match'))).toThrow(
            DuplicateSceneRegistrationError,
        );
    });

    it('throws when resolving an unknown scene', () => {
        const registry = new SceneRegistry<BaseGameSnapshot>();

        expect(() => registry.resolve(sceneId('engine:missing'))).toThrow(UnknownSceneError);
    });

    it('exposes required assets for validation tooling', () => {
        const texture = buildAssetRef('texture', 'tactics/scene/loading.webp');
        const descriptor: SceneDescriptor<BaseGameSnapshot> = {
            sceneId: sceneId('engine:loading'),
            defaultScreen: 'board',
            requiredAssets: [texture],
            initialize(state) {
                return state;
            },
        };
        const registry = new SceneRegistry<BaseGameSnapshot>();

        registry.register(descriptor);

        expect(registry.requiredAssets(sceneId('engine:loading'))).toEqual([texture]);
    });

    it('accepts descriptors that operate on normal BaseGameSnapshot state', () => {
        const host = playerId('host');
        const descriptor = makeDescriptor('engine:match');
        const snapshot: BaseGameSnapshot = {
            tick: 0,
            seed: 1,
            players: { [host]: { id: host } },
            entities: {},
            phase: gamePhase('playing'),
            events: [],
            turnNumber: 0,
            hostPlayerId: host,
            timers: {},
            matchResult: null,
            sceneId: sceneId('engine:match'),
            sceneTransition: null,
        };

        expect(descriptor.initialize(snapshot, {}, makeContext())).toBe(snapshot);
    });
});

function makeContext(): GameReduceContext {
    return {
        rng: makeStubRng(),
        dispatchDepth: 0,
    };
}
