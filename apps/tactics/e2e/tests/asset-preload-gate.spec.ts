/**
 * F83 — asset-preload-gate.spec.ts
 *
 * The route-entry asset reveal gate (§4.10), against the packaged renderer.
 *
 * Everything else about the gate is unit-provable; what is not is that the
 * scrim actually goes black over a mounted shell and actually comes back. This
 * spec asserts BOTH halves, because only the pair separates "the gate released"
 * from "the gate is absent" — a spec asserting the release alone passes on a
 * build that never held anything.
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

    const heldMs = durationWhere(
        timeline,
        (sample) => sample.canvasMounted && sample.screenFadeOpacity === '1',
    );
    // Half one, as the criterion words it: the shell was mounted and NOT shown.
    // A preload gates a reveal, never a mount — withholding the shell would
    // orphan the AssetManager whose unique disposer it is (Invariant #21).
    expect(heldMs, context).toBeGreaterThan(0);

    const heldUnderCoverMs = durationWhere(
        timeline,
        (sample) =>
            sample.canvasMounted && sample.routeCoverMounted && sample.screenFadeOpacity === '1',
    );
    // The leg that makes half one non-vacuous, and it is the COVER that carries
    // it rather than the duration.
    //
    // MEASURED, macOS local, 3 runs each. With the gate: the scrim is opaque
    // over the mounted shell for 34.1 / 37.0 / 37.3 ms, all of it under the
    // route-entry cover. With the gate removed — `sceneReady = shellReady` in
    // `renderer/app/game/page.tsx` — the same state still lasts 5.1 / 5.9 /
    // 9.6 ms (a spread that reached 21.5 ms over six runs), because the
    // fade-in runs in a passive effect one turn AFTER the commit that mounts
    // the shell. So a duration floor separates the two builds by a handful of
    // milliseconds and nothing structural. The cover does not: it is decided in
    // RENDER by the same `sceneReady` term, so a build without the gate renders
    // it never — 0 ms in 3/3 runs, against the full hold in 3/3 gated runs.
    expect(heldUnderCoverMs, context).toBeGreaterThan(0);

    // Half two: it came back. `readyAndStart` already waited on this, so what
    // is asserted here is that the state SURVIVED to the spec — a gate that
    // re-armed would be as broken as one that never released.
    await expect(hostWindow.getByTestId('screen-fade-overlay')).toHaveCSS('opacity', '0');
});
