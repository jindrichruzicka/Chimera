// apps/tactics/simulation/scenes.ts
//
// Tactics' contributed scenes (§4.18–§4.19). Registered into the host's scene
// registry through `MainGameContribution.registerScenes`: the registry is a
// local inside the host's wiring and never escapes, so what a descriptor
// declares reaches the renderer on the snapshot rather than by reference.

import type { AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { BaseGameSnapshot } from '@chimera-engine/simulation/engine/types.js';
import { sceneId, type SceneRegistry } from '@chimera-engine/simulation/scene/index.js';

/**
 * The asset-demo scene: the reference game's exercise of the scene preload arm.
 *
 * Its `requiredAssets` list is non-empty — see `scenes.test.ts`. The engine's
 * own scenes declare `[]` (`DefaultScenes.ts`), so a preload arm with nothing
 * but those can ship green and never execute a load.
 */
export const TACTICS_ASSET_DEMO_SCENE_ID = sceneId('tactics:asset-demo');

export function registerTacticsScenes(registry: SceneRegistry<BaseGameSnapshot>): void {
    registry.register({
        sceneId: TACTICS_ASSET_DEMO_SCENE_ID,
        // Its OWN screen key, not `playfield`, so what the screen registry
        // declares against this string reaches this scene and no other.
        defaultScreen: 'asset-demo',
        /**
         * The refs the demo scene waits on. Every one is `priority: 'deferred'`
         * in `asset-manifest.ts`, deliberately: a `critical` ref is already
         * warmed by the manifest-level preload before a match starts, so a
         * scene declaring one would gate on a load that had already happened.
         * These four are cold when the scene is entered.
         *
         * Written as BARE STRING LITERALS in an inline array — not
         * `tacticsModelRefs.showcaseRig`, and not a const holding the list.
         * MEASURED: `validate-assets` finds this list by its property name and
         * then walks only `isStringLiteral` elements of an array literal
         * (`as`/`satisfies` around the whole array is unwrapped; a per-element
         * cast is not). A const reference or a member expression is therefore
         * read as an EMPTY list, and Invariant #52's two checks — every
         * declared ref exists on disk, every declared ref is in a manifest —
         * pass at exit 0 with nothing checked.
         *
         * Hence the widening cast rather than a per-element one: `AssetRef` is
         * `string & { __assetRef }`, and an array of bare strings does not
         * overlap it, so TypeScript requires the trip through `unknown`. The
         * elements have to stay unadorned for the walk above to see them.
         *
         * The duplication that buys is made safe by `scenes.test.ts`, which
         * asserts this list equals the manifest consts it mirrors: a ref
         * renamed in `asset-manifest.ts` reds there rather than pointing the
         * scene at a file that is no longer shipped.
         */
        requiredAssets: [
            'tactics/models/showcase-rig.glb',
            'tactics/audio/sfx/step.wav',
            'tactics/audio/sfx/sword-hit.wav',
            'tactics/audio/sfx/reveal.wav',
        ] as unknown as readonly AssetRef[],
        // Seeds nothing: this scene exists to be waited for, and a demo that
        // perturbed the running match would not be one.
        initialize: (state) => state,
    });
}
