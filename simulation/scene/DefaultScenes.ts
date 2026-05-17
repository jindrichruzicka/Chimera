import type { BaseGameSnapshot } from '../engine/types.js';
import { sceneId } from '../engine/types.js';
import type { SceneRegistry } from './SceneRegistry.js';

export function registerDefaultScenes(registry: SceneRegistry<BaseGameSnapshot>): void {
    registry.register({
        sceneId: sceneId('engine:lobby'),
        defaultScreen: 'lobby',
        requiredAssets: [],
        initialize: (state) => state,
    });
    registry.register({
        sceneId: sceneId('engine:game'),
        defaultScreen: 'board',
        requiredAssets: [],
        initialize: (state) => state,
    });
    registry.register({
        sceneId: sceneId('engine:post-game'),
        defaultScreen: 'summary',
        requiredAssets: [],
        initialize: (state) => state,
    });
}
