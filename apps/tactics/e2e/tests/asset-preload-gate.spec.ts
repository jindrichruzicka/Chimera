/**
 * F83 — asset-preload-gate.spec.ts
 *
 * The route-entry asset reveal gate (§4.10), against the packaged renderer.
 *
 * Everything else about the gate is unit-provable; what is not is that the
 * screen actually goes black over a mounted shell and actually comes back, in
 * the packaged build.
 *
 * WHAT THIS SPEC NO LONGER CLAIMS. It used to separate "the gate released" from
 * "the gate is absent", and the thing that carried that was the route cover:
 * mounted in RENDER off the same term the gate answers, so a build without the
 * gate rendered it never. Tactics declares no cover, and the loading beat only
 * mounts one where a game declared it, so that artefact is gone from this path.
 * What is left — the shell mounted with its HUD withheld — walks the same
 * phases on a gateless build, one commit apart instead of one preload apart, so
 * it is a duration difference and not a structural one. The gate's own
 * non-vacuity is carried by its unit suite (four settle paths and a budget that
 * does not collapse under the flag); what this spec still proves is that the
 * packaged build sequences the entry at all, and that tactics gets no cover it
 * did not ask for.
 *
 * The full lobby → game hop is the only path that goes black: a direct boot
 * starts on a transparent scrim, so the fade-in it never performs cannot be
 * missed. That hop is `game.fixture`'s auto-advance, which finishes before the
 * test body runs, hence the recorder installed in the overridden `hostWindow`
 * fixture below.
 *
 * The gate is never disabled under `NEXT_PUBLIC_CHIMERA_E2E` — this build is
 * one of the environments performing real `chimera://` fetches, and collapsing
 * the gate here would make this spec pass vacuously.
 */
import { test as gameTest, expect } from '../fixtures/game.fixture';
import {
    durationWhere,
    installRevealTimeline,
    readRevealTimeline,
} from '../helpers/reveal-timeline';

/**
 * `game.fixture` advances lobby → game in an auto-fixture, so the recorder has
 * to be armed while the fixture graph is still being built. Overriding
 * `hostWindow` is what orders it: `_matchStarted` depends on `hostWindow`, so
 * this runs first. Only the host is instrumented — both windows run their own
 * gate, and one of them is the claim.
 */
const test = gameTest.extend({
    hostWindow: async ({ hostWindow }, use) => {
        await installRevealTimeline(hostWindow);
        await use(hostWindow);
    },
});

test('holds the app-level scrim opaque over the mounted shell, then reveals it', async ({
    hostWindow,
}) => {
    const timeline = await readRevealTimeline(hostWindow);
    const context = `reveal timeline: ${JSON.stringify(timeline)}`;

    const heldMs = durationWhere(timeline, (sample) => sample.canvasMounted && !sample.hudMounted);
    // Half one, as the criterion words it: the shell was mounted and NOT shown.
    // A preload gates a reveal, never a mount — withholding the shell would
    // orphan the AssetManager whose unique disposer it is (Invariant #21).
    expect(heldMs, context).toBeGreaterThan(0);

    // The entry was sequenced rather than jumped: the beat passed through its
    // pre-reveal phases in order before anything was shown. Falsified by a
    // route that revealed straight from mount, which is what a build with the
    // seam unwired would do.
    //
    // Not asserted against the curtain: the HUD deliberately mounts while the
    // curtain is still opaque, one commit before the closing fade, so the grid
    // row it adds resizes the canvas under black rather than in front of the
    // player. A sample with the HUD up and the scrim at 1 is that commit.
    const phases = timeline.samples
        .map((sample) => sample.revealPhase)
        .filter((phase): phase is string => phase !== null);
    expect(phases, context).toContain('covered');
    expect(phases.indexOf('covered')).toBeLessThan(phases.indexOf('revealed'));

    // Tactics declares no route cover, so it takes the beat's coverless path:
    // black until the settle, then one reveal. Asserted rather than assumed,
    // because it is what makes the negative control in `hud-layout.spec.ts`
    // mean something — a game gets no cover it did not ask for.
    const coveredMs = durationWhere(timeline, (sample) => sample.routeCoverMounted);
    expect(coveredMs, context).toBe(0);

    // Half two: it came back. `readyAndStart` already waited on this, so what
    // is asserted here is that the state SURVIVED to the spec — a gate that
    // re-armed would be as broken as one that never released.
    await expect(hostWindow.getByTestId('screen-fade-overlay')).toHaveCSS('opacity', '0');
    await expect(hostWindow.getByTestId('game-hud-slot')).toBeVisible();
});
