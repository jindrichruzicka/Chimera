import type { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import type { BaseGameSnapshot } from '@chimera-engine/simulation/engine/types.js';
import {
    registerDefaultScenes,
    SceneManager,
    SceneRegistry,
} from '@chimera-engine/simulation/scene/index.js';
import type { MainGameContribution } from '../game/mainGameRegistry.js';

/**
 * Build the scene registry, let every contribution add to it, and wire the
 * resulting `SceneManager`'s actions into `registry`.
 *
 * The `SceneRegistry` stays a local and never escapes: the renderer reaches
 * scenes only through the snapshot channel, and the only question a caller can
 * ask of what was registered is `engine:scene_prepare`'s own validation.
 *
 * `contributions` is optional so a call with no games still registers the
 * engine's own scenes. It is typed as the narrow `Pick` rather than the whole
 * contribution because this is all the wiring reads; a full
 * `MainGameContribution` satisfies it structurally.
 */
export function wireDefaultSceneActions(
    registry: ActionRegistry,
    contributions: readonly Pick<MainGameContribution, 'registerScenes'>[] = [],
): void {
    const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
    registerDefaultScenes(sceneRegistry);
    for (const contribution of contributions) {
        contribution.registerScenes?.(sceneRegistry);
    }
    new SceneManager(sceneRegistry).registerActions(registry);
}
