/**
 * model-instances.spec.ts
 * §4.10 Asset Reference System → model seam adoption.
 *
 * The end-to-end proof that the GLTF runtime path works in the real runtime:
 * the `/model-showcase/` route mounts TWO `useModelInstance` components on ONE
 * `gltf-model` ref, and this spec runs against the static export served over
 * `chimera://` — the first code path ever to load the webpack async GLTFLoader
 * chunk (`__webpack_require__.e`) through the custom protocol.
 *
 * The showcase lives on its own route, reached only from here (why:
 * `TacticsModelShowcaseScreen`).
 *
 * The route needs NO match: it opens its own game asset session
 * (`<GameAssetSession>`), so this uses the plain single-window Electron
 * fixture rather than the host+client direct-game pair.
 *
 * What is asserted, and why each half is needed:
 *
 *   1. **The scene-graph facts pixels cannot show.** The showcase status
 *      element carries what only the scene graph knows: both instances
 *      loaded with no error, their roots are DISTINCT objects (a cached scene
 *      mounted twice collapses into one root and the first mount vanishes),
 *      and posing instance A's bone did not move instance B's (a plain
 *      `.clone()` shares the skeleton, so the pose would bleed through).
 *   2. **The pixels the scene-graph facts cannot show.** The magenta pixel
 *      count proves the clones actually rasterize — the model decoded, the
 *      protocol served real bytes, and the unlit magenta quads are on screen.
 *
 * NOT covered here, deliberately: no harness in this repo launches an
 * electron-builder packaged app — packaging remains a manual gate item, and
 * that includes the route gate's 404 (its unit test covers the gate function
 * and the `notFound()` call). This spec exercises the `.e2e-build`
 * static-export layout only. No motion is awaited anywhere (the pose is
 * applied before the first report), so the occluded-window frozen-transition
 * hazard does not apply.
 */

import { expect, test } from '../fixtures/electron.fixture';
import { ModelShowcasePage } from '../pages/ModelShowcasePage';

/** Authored in `TacticsModelShowcase` — instance A's top bone, radians. */
const EXPECTED_POSE_A = (Math.PI / 2).toFixed(3);
const EXPECTED_POSE_B = (0).toFixed(3);

test.describe('Tactics model seam adoption', () => {
    test('mounts two independent clones of one gltf ref over chimera://', async ({
        mainWindow,
    }) => {
        // Pixel assertions cost one canvas screenshot each; CI software-GL
        // screenshots were measured at 6-11s (see tactics-3d-render.spec.ts).
        test.slow();
        const showcase = new ModelShowcasePage(mainWindow);

        await showcase.goto();
        await expect(showcase.canvas).toBeVisible({ timeout: 15_000 });

        // The load is on-demand and async, so the long budget sits on the one
        // attribute that TRANSITIONS when both instances have reported —
        // success or failure alike. Only then is the error attribute read: a
        // failed load shows its name here (an undeclared manifest ref rejects
        // with UnknownAssetManifestEntryError, and a route with no asset
        // session at all rejects with NoActiveGameSessionError) instead of a
        // generic timeout.
        await expect(showcase.status).toHaveAttribute('data-models-settled', 'true', {
            timeout: 15_000,
        });
        await expect(showcase.status).toHaveAttribute('data-model-error', '');
        await expect(showcase.status).toHaveAttribute('data-models-loaded', '2');

        // Two DISTINCT scene-graph roots, and A's pose stayed out of B.
        await expect(showcase.status).toHaveAttribute('data-model-roots-distinct', 'true');
        await expect(showcase.status).toHaveAttribute('data-model-pose-a', EXPECTED_POSE_A);
        await expect(showcase.status).toHaveAttribute('data-model-pose-b', EXPECTED_POSE_B);

        // And the clones are really on screen: the showcase quads are the only
        // geometry in this scene.
        await showcase.assertCanvasHasMagentaPrimitive();
    });
});
