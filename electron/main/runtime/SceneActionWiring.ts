import type { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import {
    registerDefaultScenes,
    SceneManager,
    SceneRegistry,
} from '@chimera/simulation/scene/index.js';

export function wireDefaultSceneActions(registry: ActionRegistry): void {
    const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
    registerDefaultScenes(sceneRegistry);
    new SceneManager(sceneRegistry).registerActions(registry);
}
