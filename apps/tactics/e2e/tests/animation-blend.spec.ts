/**
 * animation-blend.spec.ts
 *
 * Feature reference: F89 — Blended Clip Transitions,
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`. Adopted by a game.
 *
 * The blend chain has an end-to-end proof already —
 * `renderer/animation/__tests__/blended-transition.test.ts` drives a real
 * `ClipPlayer` over a real `MeshClipBackend` over a real `AnimationMixer`. What
 * it cannot reach is everything between a game's authoring and the screen: the
 * packaged `.glb`, the manifest sheet the clip's blend length is authored in, the
 * parse that turns it into a compiled timeline, and the R3F mount that drives the
 * whole thing off a frame clock. A blend that works in a unit and never reaches a
 * window would leave every one of those green.
 *
 * So this drives the transition the way a player would — a click on the
 * `/model-showcase/` route's toggle — and asks the running app what it is posing.
 *
 * **Why a bone rotation, and why a BAND.** The two clips in the fixture pose the
 * same bone: `wave` sweeps it to ±20°, `lean` holds it at 60°. A rotation between
 * the two is one NEITHER can produce on its own at any weight, so observing one
 * is observing them mixed — which a cut, a restart, or a clip that never changed
 * cannot fake. The band is `helpers/showcase-clip-poses.ts`, whose own test reads
 * both angles back off the committed container.
 *
 * **Why polling rather than a screenshot.** A blend is a transient, the two clips
 * differ by a rotation rather than by colour, and this route's magenta quads look
 * identical at every angle. The bone rotation is written to a DOM attribute once
 * per frame, so a poll over it samples the transient. A poll that misses times
 * out — it cannot pass falsely.
 *
 * **How much of the blend is samplable.** DERIVED from the ramp: the published
 * angle is `wave(t)·(1 − u) + 60°·u` for `u = t / blendInSeconds`, with `wave`
 * inside ±20°, so it is above the swing's peak for every `u > 0.5` whatever phase
 * the swing was on. Half the authored blend is therefore in the band for certain
 * — 0.6 s at the 1.2 s the manifest authors — and up to all of it when the click
 * lands near a peak. The blend is REAL TIME, so that window does not shrink on a
 * slow runner; what shrinks is how many frames repaint inside it. If this spec
 * ever reds on CI, the first thing to weigh is whether 0.6 s bought a sample,
 * and the knob for that is the authored blend length rather than the poll
 * interval.
 *
 * The route needs NO match: it opens its own game asset session, so the plain
 * single-window Electron fixture is the whole harness (see
 * `model-instances.spec.ts`, which owns the statement of what this route is).
 *
 * NOT covered here: the beat half of the feature. Tactics is `realtime: false`,
 * so no `engine:tick` is dispatched on this route and the clips free-run off the
 * frame clock; the authored beat windows are verified at content load by
 * `content/tacticsAnimations.ts` instead.
 */

import { expect, test } from '../fixtures/electron.fixture';
import { ModelShowcasePage } from '../pages/ModelShowcasePage';
import {
    SHOWCASE_BLEND_BAND,
    SHOWCASE_LEAN_POSE_RADIANS,
    isBlendedRotation,
} from '../helpers/showcase-clip-poses';
import {
    tacticsShowcaseLeanClip,
    tacticsShowcaseWaveClip,
} from '@chimera-engine/tactics/asset-manifest.js';

/** How long a poll over the bone rotation may run before it is a failure. */
const SAMPLE_TIMEOUT_MS = 20_000;

/**
 * How often to sample the bone rotation while a blend is running.
 *
 * Tight, and deliberately tighter than Playwright's default back-off (100 ms,
 * then 250, 500, 1000): the thing being caught lasts about a second, so a
 * back-off would spend most of it asleep.
 */
const SAMPLE_INTERVALS_MS = [50];

/**
 * Wait until the route is showing a LIVE `wave` — loaded, playing and advancing.
 *
 * Both halves are needed before a toggle means anything. The rotation attribute
 * is absent until the first frame and empty until the model resolves, so the
 * first poll is the absent/empty→written transition; and a blend needs something
 * to blend OUT of, which a loaded-but-idle clip is not. A moved bone is what says
 * the action is really advancing, since nothing else moves one.
 */
async function waitForLiveSwing(showcase: ModelShowcasePage): Promise<void> {
    await expect.poll(async () => showcase.playedBoneRotation(), { timeout: 15_000 }).not.toBeNaN();

    const first = await showcase.playedBoneRotation();
    await expect
        .poll(async () => showcase.playedBoneRotation(), {
            intervals: SAMPLE_INTERVALS_MS,
            timeout: SAMPLE_TIMEOUT_MS,
        })
        .not.toBe(first);
}

test.describe('Tactics blended clip transition', () => {
    test('blends into the clip a toggle declares, then settles on it alone', async ({
        mainWindow,
    }) => {
        // Two waits for the app to reach a live clip and one for a whole blend to
        // run, each generously budgeted for a software-GL CI runner.
        test.slow();
        const showcase = new ModelShowcasePage(mainWindow);

        await showcase.goto();
        await expect(showcase.canvas).toBeVisible({ timeout: 15_000 });

        await waitForLiveSwing(showcase);
        await expect(showcase.clipToggle).toHaveAttribute(
            'data-showcase-clip',
            tacticsShowcaseWaveClip.name,
        );
        // The control instance's bone, before anything is asked for. Read here as
        // well as at the end, because one reading at the end is satisfied by a
        // control that moved during the blend and came back.
        expect(await showcase.clipAttribute('clip-control-bone-z')).toBe('0.0000');

        await showcase.toggleClip();

        // The click landed and the screen declares the other clip. Read first, so
        // a band that never fills is diagnosed as a blend that did not happen
        // rather than as a click that did not.
        await expect(showcase.clipToggle).toHaveAttribute(
            'data-showcase-clip',
            tacticsShowcaseLeanClip.name,
        );

        // The blend itself: a rotation between the swing's peak and the lean's
        // hold, which neither clip can pose alone. Every sample is kept rather
        // than only the last, because the band is a window in time — a sample
        // taken after the blend arrived is legitimately outside it.
        const blended: number[] = [];
        await expect
            .poll(
                async () => {
                    const rotation = await showcase.playedBoneRotation();
                    if (isBlendedRotation(rotation)) {
                        blended.push(rotation);
                    }
                    return blended.length;
                },
                { intervals: SAMPLE_INTERVALS_MS, timeout: SAMPLE_TIMEOUT_MS },
            )
            .toBeGreaterThan(0);

        for (const rotation of blended) {
            expect(rotation).toBeGreaterThan(SHOWCASE_BLEND_BAND.above);
            expect(rotation).toBeLessThan(SHOWCASE_BLEND_BAND.below);
        }

        // …and the blend ARRIVES: the incoming clip ends up posing the bone on
        // its own. A transition that stalled halfway would sit inside the band
        // for ever and satisfy everything above it.
        await expect
            .poll(async () => showcase.playedBoneRotation(), { timeout: SAMPLE_TIMEOUT_MS })
            .toBeCloseTo(SHOWCASE_LEAN_POSE_RADIANS, 3);

        // The control instance carries a mixer with no action, and is at rest on
        // both sides of the transition: a bone that moved there would mean a
        // second driver on one root (Rule ONE-MIXER-PER-ROOT), which would make
        // every reading above suspect.
        expect(await showcase.clipAttribute('clip-control-bone-z')).toBe('0.0000');
    });

    test('comes back out of the clip it blended into', async ({ mainWindow }) => {
        // The second transition of an A→B→A alternation is its own case: the
        // outgoing clip is one the player has been holding since the first blend,
        // and the bookkeeping that releases it is what decides whether the model
        // is stuck on a pose nothing is playing. A player that stranded it would
        // leave the bone at the lean's hold for ever with nothing thrown.
        //
        // The way back is a CUT, not a blend — `wave` authors no `blendInSeconds`
        // and the screen names none — so what is asserted is the destination, not
        // a band: a cut has no observable middle.
        test.slow();
        const showcase = new ModelShowcasePage(mainWindow);

        await showcase.goto();
        await expect(showcase.canvas).toBeVisible({ timeout: 15_000 });
        await waitForLiveSwing(showcase);

        await showcase.toggleClip();
        await expect
            .poll(async () => showcase.playedBoneRotation(), { timeout: SAMPLE_TIMEOUT_MS })
            .toBeCloseTo(SHOWCASE_LEAN_POSE_RADIANS, 3);

        await showcase.toggleClip();
        await expect(showcase.clipToggle).toHaveAttribute(
            'data-showcase-clip',
            tacticsShowcaseWaveClip.name,
        );

        // Back inside the swing's own range, which the lean's hold is well
        // outside of — and the swing is symmetric, so the peak bounds it in both
        // directions.
        await expect
            .poll(async () => Math.abs(await showcase.playedBoneRotation()), {
                intervals: SAMPLE_INTERVALS_MS,
                timeout: SAMPLE_TIMEOUT_MS,
            })
            .toBeLessThanOrEqual(SHOWCASE_BLEND_BAND.above);
    });
});
