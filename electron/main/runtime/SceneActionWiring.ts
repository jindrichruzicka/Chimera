import type { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import type { BaseGameSnapshot } from '@chimera-engine/simulation/engine/types.js';
import {
    registerDefaultScenes,
    SceneManager,
    SceneRegistry,
} from '@chimera-engine/simulation/scene/index.js';

export function wireDefaultSceneActions(registry: ActionRegistry): void {
    const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
    registerDefaultScenes(sceneRegistry);
    new SceneManager(sceneRegistry).registerActions(registry);
}
