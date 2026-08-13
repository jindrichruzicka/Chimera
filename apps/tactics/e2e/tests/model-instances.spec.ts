/**
 * model-instances.spec.ts
 * §4.10 Asset Reference System → model seam adoption.
 *
 * The end-to-end proof that the GLTF runtime path works in the real runtime.
 * The `/model-showcase/` route mounts FOUR `useModelInstance` components across
 * TWO `gltf-model` refs, in two pairs: the SEAM pair, two instances of the
 * unanimated rig, and the CLIP-PLAYER pair, two instances of the animated one.
 * This spec runs against the static export served over `chimera://` — the first
 * code path ever to load the webpack async GLTFLoader chunk
 * (`__webpack_require__.e`) through the custom protocol.
 *
 * The showcase lives on its own route (why: `TacticsModelShowcaseScreen`).
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
 *   3. **That a clip actually advances.** The second test polls a bone
 *      rotation written from the frame loop, which the component suites cannot
 *      reach: they build their own `AnimationClip`, so what they prove is the
 *      wiring, not that the GENERATED container decodes into a playable clip.
 *
 * NOT covered here, deliberately: no harness in this repo launches an
 * electron-builder packaged app — packaging remains a manual gate item, and
 * that includes the route gate's 404 (its unit test covers the gate function
 * and the `notFound()` call). This spec exercises the `.e2e-build`
 * static-export layout only.
 *
 * The FIRST test awaits no motion — the pose is applied before the first report
 * — so the occluded-window frozen-transition hazard does not touch it. The
 * second one does await motion, and cannot avoid it: an advancing clip is the
 * property. An occluded window stalls the rAF chain and would time it out
 * rather than pass it falsely, which is the direction that hazard fails in.
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

    test('plays a clip on one instance while the mixer-only twin stays still', async ({
        mainWindow,
        rendererConsole,
    }) => {
        // The clip-player half of the route (feature F82). The pair here is ONE
        // animated ref resolved twice: one instance under `useClipPlayer`, one
        // under plain `useModelAnimation`. Same model, same clip data, same
        // frame loop — so a moving control bone could only come from a second
        // mixer on one root (Rule ONE-MIXER-PER-ROOT), and a still played bone
        // means the clip never advanced.
        //
        // Read off the DOM rather than off pixels: the swing is a LOOP, so two
        // screenshots taken an unknown interval apart can legitimately show the
        // same frame. The bone rotation cannot.
        //
        // Tactics is `realtime: false`, so no `engine:tick` is ever dispatched
        // here: the clip free-runs off the frame clock. The simulation half of
        // the feature — beat windows, dilation, `onBeat` — is NOT exercised by
        // this spec.
        test.slow();
        const showcase = new ModelShowcasePage(mainWindow);

        await showcase.goto();
        await expect(showcase.canvas).toBeVisible({ timeout: 15_000 });

        // The attributes are ABSENT until the first frame writes them, and the
        // model load is on demand — so this waits for the absent→written
        // transition, which is the long one.
        //
        // Written as a poll rather than `.not.toHaveAttribute(…, '')`: MEASURED
        // in playwright-core's injected script, `to.have.attribute.value`
        // answers `{received: null, matches: false}` for a MISSING attribute, so
        // under `.not` that assertion resolves immediately while nothing has
        // been written at all.
        await expect
            .poll(async () => showcase.clipAttribute('clip-played-bone-z'), { timeout: 15_000 })
            .toMatch(/^-?\d+\.\d{4}$/u);

        const firstSample = await showcase.clipAttribute('clip-played-bone-z');
        // The control is under a mixer with no action: it must read as the rest
        // pose, and reading it at all proves the attribute is being written.
        expect(await showcase.clipAttribute('clip-control-bone-z')).toBe('0.0000');

        // Two samples of the SAME attribute, taken across real frames. The clip
        // is one second long and swings ±20°, so any two instants a few hundred
        // milliseconds apart differ — except the two the swing passes through
        // symmetrically, which is why this polls for a difference instead of
        // sleeping once and comparing.
        await expect
            .poll(async () => showcase.clipAttribute('clip-played-bone-z'), { timeout: 10_000 })
            .not.toBe(firstSample);

        // The marks fired, and the passage closed for a PLAYHEAD reason rather
        // than a teardown one — a passage that only ever closes as 'released'
        // means the clip was torn down, not played through.
        //
        // 'reached-end', not 'looped', and that is a property of THIS sheet:
        // MEASURED against the real scheduler, a passage closes as 'looped' only
        // if it is still open at the wrap, and this one ends at phase 0.75. A
        // sheet whose passage ran to the clip's end would report the other.
        //
        // Each mark gets its OWN poll, because the two are a quarter of a cycle
        // apart: `crest` is authored at 0.5 s of a 1 s clip while the passage
        // closes at phase 0.75, so the notify tally rises 250 ms of clip time
        // before the end reason is written. A reason read off the tally's poll
        // is therefore read before anything has written it — the attribute
        // answers `''`, and a bare assertion has no second chance.
        await expect
            .poll(async () => Number(await showcase.clipAttribute('clip-notifies')), {
                timeout: 10_000,
            })
            .toBeGreaterThan(0);
        await expect
            .poll(async () => showcase.clipAttribute('clip-passage-end-reason'), {
                timeout: 10_000,
            })
            .toBe('reached-end');

        // And the control never moved while all that happened.
        expect(await showcase.clipAttribute('clip-control-bone-z')).toBe('0.0000');

        // A duplicate mixer binding is REPORTED through the log bridge rather
        // than thrown, so it would leave every assertion above green — and it
        // reports one frame LATE, which is why this is read at the end rather
        // than beside the first sample.
        expect(
            rendererConsole.filter((entry) =>
                entry.text.includes('more than one animation hook is bound to one model root'),
            ),
        ).toEqual([]);
    });
});
