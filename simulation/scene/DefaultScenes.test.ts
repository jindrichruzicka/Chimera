import { describe, expect, it } from 'vitest';
import type { BaseGameSnapshot } from '../engine/types.js';
import { sceneId } from '../engine/types.js';
import { SceneRegistry } from './SceneRegistry.js';
import { registerDefaultScenes } from './DefaultScenes.js';

describe('registerDefaultScenes', () => {
    it('registers the lobby, match, and post-game engine scenes', () => {
        const registry = new SceneRegistry<BaseGameSnapshot>();

        registerDefaultScenes(registry);

        expect(registry.has(sceneId('engine:lobby'))).toBe(true);
        expect(registry.has(sceneId('engine:game'))).toBe(true);
        expect(registry.has(sceneId('engine:post-game'))).toBe(true);
    });

    it('declares no required assets on any engine scene', () => {
        // `engine:start_game` and `engine:return_to_lobby` write an EMPTY
        // `sceneRequiredAssets` beside the engine scene they enter, rather than
        // resolving it — those reducers hold no registry. This is the pin on
        // that coupling: an engine scene that started declaring refs would make
        // the written array wrong, and reds here rather than at runtime.
        const registry = new SceneRegistry<BaseGameSnapshot>();

        registerDefaultScenes(registry);

        expect(registry.requiredAssets(sceneId('engine:lobby'))).toEqual([]);
        expect(registry.requiredAssets(sceneId('engine:game'))).toEqual([]);
        expect(registry.requiredAssets(sceneId('engine:post-game'))).toEqual([]);
    });

    it('uses playfield as the game scene default screen', () => {
        const registry = new SceneRegistry<BaseGameSnapshot>();

        registerDefaultScenes(registry);

        expect(registry.resolve(sceneId('engine:game')).defaultScreen).toBe('playfield');
    });
});
