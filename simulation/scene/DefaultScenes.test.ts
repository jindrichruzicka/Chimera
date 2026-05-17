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

    it('uses board as the game scene default screen', () => {
        const registry = new SceneRegistry<BaseGameSnapshot>();

        registerDefaultScenes(registry);

        expect(registry.resolve(sceneId('engine:game')).defaultScreen).toBe('board');
    });
});
