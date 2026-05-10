import { describe, expect, it } from 'vitest';
import type { BaseGameSnapshot } from '../engine/types.js';
import { sceneId } from '../engine/types.js';
import { SceneRegistry } from './SceneRegistry.js';
import { registerDefaultScenes } from './DefaultScenes.js';

describe('registerDefaultScenes', () => {
    it('registers the lobby, match, and post-match engine scenes', () => {
        const registry = new SceneRegistry<BaseGameSnapshot>();

        registerDefaultScenes(registry);

        expect(registry.has(sceneId('engine:lobby'))).toBe(true);
        expect(registry.has(sceneId('engine:match'))).toBe(true);
        expect(registry.has(sceneId('engine:post-match'))).toBe(true);
    });

    it('uses board as the match scene default screen', () => {
        const registry = new SceneRegistry<BaseGameSnapshot>();

        registerDefaultScenes(registry);

        expect(registry.resolve(sceneId('engine:match')).defaultScreen).toBe('board');
    });
});
