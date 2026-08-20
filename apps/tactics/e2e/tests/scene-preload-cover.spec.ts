/**
 * F83 — scene-preload-cover.spec.ts
 *
 * The scene preload arm (§4.10) and the opt-in loading cover (§4.36), against
 * the packaged renderer.
 *
 * Tactics' `tactics:asset-demo` declares a non-empty `requiredAssets` list
 * (`apps/tactics/simulation/scenes.test.ts`), which is what gives the arm
 * something to do here: the engine's own scenes declare `[]`, and a preload with
 * nothing to wait for could ship green having never executed a load. What is
 * asserted here is what a real build alone can show — the refs travel main →
 * renderer on the snapshot, the cover is resolved through the game's registry,
 * the fraction is produced by loads over `chimera://`, and the cover leaves
 * against a curtain still painted.
 *
 * Neither budget is disabled under `NEXT_PUBLIC_CHIMERA_E2E`; determinism comes
 * from the recorded timeline, not from a collapsed gate.
 */
import { tacticsBundleEn } from '@chimera-engine/tactics/shell/translations/en.js';
import { test, expect } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';
import { installRevealTimeline, readRevealTimeline } from '../helpers/reveal-timeline';
import { expectSceneCommitted, requestScene } from '../helpers/scene-transition';

/** Tactics' contributed scene — `TACTICS_ASSET_DEMO_SCENE_ID` in `apps/tactics/simulation/scenes.ts`. */
const ASSET_DEMO_SCENE_ID = 'tactics:asset-demo';
/** The scene a running match is committed to, and the precondition for the hop. */
const IN_MATCH_SCENE_ID = 'engine:game';
/** The token tactics declares as `loadingScreens['asset-demo']`'s `{ message }`. */
const ASSET_DEMO_COVER_TOKEN = 'game.tactics.scene.assetDemoLoading';

test('covers the entering scene with the declared cover, reports a fraction, then commits', async ({
    hostApp,
    hostWindow,
    clientWindow,
}) => {
    // Resolved from tactics' own en bundle rather than written out here: the
    // registry declares a KEY, and `t` returns an unknown key unchanged, so a
    // hard-coded string would keep passing after the token stopped resolving.
    const coverText = tacticsBundleEn[ASSET_DEMO_COVER_TOKEN];
    expect(coverText, `tactics declares no en string for ${ASSET_DEMO_COVER_TOKEN}`).toBeTruthy();

    await installRevealTimeline(hostWindow);
    await requestScene(hostApp, hostWindow, ASSET_DEMO_SCENE_ID, IN_MATCH_SCENE_ID);

    const hostGame = new GamePage(hostWindow);
    const clientGame = new GamePage(clientWindow);
    // The barrier poll clears the 5 s scene-preload budget by a 10 s margin, so
    // a preload that never settles commits on the fail-open INSIDE this budget
    // rather than reding here as a hung barrier. A timeout is therefore never
    // "the preload hung" — `expectSceneCommitted` reads the host's own view of
    // the barrier and names which half is actually late.
    await expectSceneCommitted(
        hostApp,
        {
            host: {
                committedScene: () => hostGame.activeSceneId(),
                stalledState: () => hostGame.stalledTransitionState(),
            },
            client: {
                committedScene: () => clientGame.activeSceneId(),
                stalledState: () => clientGame.stalledTransitionState(),
            },
        },
        ASSET_DEMO_SCENE_ID,
    );
    // The committed scene's own screen, keyed on the descriptor's
    // `defaultScreen` — proof the hop landed on tactics' screen and not on the
    // `playfield` fallback `resolveScreen` returns for an unknown key.
    await expect(hostWindow.getByTestId('tactics-asset-demo')).toBeVisible();

    const timeline = await readRevealTimeline(hostWindow);
    const context = `reveal timeline: ${JSON.stringify(timeline)}`;
    const covered = timeline.samples.filter((sample) => sample.preloadCoverText === coverText);

    // 1. The game's DECLARED cover was rendered — not the engine default, which
    //    is an empty div with no text at all.
    expect(covered.length, context).toBeGreaterThan(0);

    // 2. It never stood without black behind it. The transition overlay is the
    //    only painter inside `GameShell`'s own fade provider, so its presence is
    //    the curtain being painted; asserted for EVERY covered sample, a cover
    //    that outlived the curtain reds here. That is the whole point of the
    //    sequence — a cover leaving against a lifted curtain is a scene arriving
    //    around a loading screen.
    //
    //    Deliberately NOT also pinned to the scene being LEFT. The beat holds
    //    one cover across the host's commit, so a covered sample carrying the
    //    ENTERING scene id is the design rather than a leak; requiring
    //    `IN_MATCH_SCENE_ID` here would assert the pre-convergence shape.
    expect(
        covered.map((sample) => sample.transitionOverlayMounted),
        context,
    ).toEqual(covered.map(() => true));

    // 3. The overlay carried a measured fraction while the cover was up. Every
    //    value present has to be a fraction in [0, 1]: the prop is handed the
    //    raw number, so a `String(...)`ed `null` or a defaulted `0` would still
    //    be an attribute and still satisfy a presence-only check.
    const fractions = covered
        .map((sample) => sample.preloadProgress)
        .filter((value): value is string => value !== null);
    expect(fractions.length, context).toBeGreaterThan(0);
    for (const fraction of fractions) {
        expect(Number(fraction), context).toBeGreaterThanOrEqual(0);
        expect(Number(fraction), context).toBeLessThanOrEqual(1);
    }

    // 4. The wait ENDED, with the entering scene committed underneath. A cover
    //    that never came down satisfies every assertion above — each one reads a
    //    state while the cover is up — so the terminal state is what separates a
    //    beat that completed from one that parked. Read as the last recorded
    //    state rather than as a duration: the floor collapses to 0 under
    //    `NEXT_PUBLIC_CHIMERA_E2E`, so a "how long" would read the same here
    //    whether the sequence ran or not, while what it ended in does not.
    const terminal = timeline.samples[timeline.samples.length - 1];
    expect(terminal?.preloadCoverText, context).toBeNull();
    expect(terminal?.activeSceneId, context).toBe(ASSET_DEMO_SCENE_ID);
});
