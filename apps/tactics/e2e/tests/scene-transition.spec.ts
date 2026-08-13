/**
 * F38 — scene-transition.spec.ts
 *
 * Drives engine:scene_prepare through the real renderer IPC path and verifies
 * the host-side scene manager reaches engine:post-game on both windows.
 *
 * The scene_ready acknowledgements are sent by useFadeTransition in each
 * SceneRouter, so the test never sends them; SessionRuntime auto-dispatches
 * engine:scene_commit once both players are ready. What each renderer waits for
 * before acking is the fade-out AND the entering scene's asset preload (§4.10).
 * engine:post-game declares no required assets, so here that preload is a
 * synchronous no-op — which is the second thing this spec pins: a transition
 * with nothing to load must be byte-identical to what it was before the preload
 * arm existed.
 */
import { test, expect } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';
import { installRevealTimeline, readRevealTimeline } from '../helpers/reveal-timeline';
import { SCENE_BARRIER_POLL_MS, requestScene } from '../helpers/scene-transition';

/** The scene a running match is committed to, and the precondition for the hop. */
const IN_MATCH_SCENE_ID = 'engine:game';
/** The zero-`requiredAssets` scene this spec transitions to. */
const POST_GAME_SCENE_ID = 'engine:post-game';

test('host scene_prepare transitions host and client into post-game', async ({
    hostApp,
    hostWindow,
    clientWindow,
}) => {
    const hostGame = new GamePage(hostWindow);
    const clientGame = new GamePage(clientWindow);

    await installRevealTimeline(hostWindow);
    await requestScene(hostApp, hostWindow, POST_GAME_SCENE_ID, IN_MATCH_SCENE_ID);
    await Promise.all([
        expect
            .poll(() => hostGame.activeSceneId(), { timeout: SCENE_BARRIER_POLL_MS })
            .toBe(POST_GAME_SCENE_ID),
        expect
            .poll(() => clientGame.activeSceneId(), { timeout: SCENE_BARRIER_POLL_MS })
            .toBe(POST_GAME_SCENE_ID),
        expect
            .poll(() => hostGame.activeScreenKey(), { timeout: SCENE_BARRIER_POLL_MS })
            .toBe('summary'),
        expect
            .poll(() => clientGame.activeScreenKey(), { timeout: SCENE_BARRIER_POLL_MS })
            .toBe('summary'),
    ]);
    await expect(hostGame.postGameSummary).toBeVisible();
    await expect(clientGame.postGameSummary).toBeVisible();
    await expect(hostGame.transitionOverlay).toHaveCount(0);
    await expect(clientGame.transitionOverlay).toHaveCount(0);

    // A run that waits on nothing reports NOTHING: `SceneRouter` withholds the
    // prop rather than passing a value, so the overlay stays byte-identical to
    // what it emitted before the preload arm existed. Emitting
    // `data-preload-progress="1"` on this path would satisfy a presence check
    // and falsify that property — 100% of an empty list is the SHAPE of a
    // measurement, not one somebody took.
    const timeline = await readRevealTimeline(hostWindow);
    const context = `reveal timeline: ${JSON.stringify(timeline)}`;
    const inFlight = timeline.samples.filter((sample) => sample.transitionOverlayMounted);
    // Non-vacuity: the overlay really was up. Every mutation batch is sampled,
    // so its mount and its unmount are separate states however brief the
    // transition was.
    expect(inFlight.length, context).toBeGreaterThan(0);
    expect(
        inFlight.map((sample) => [sample.preloadProgress, sample.preloadCoverText]),
        context,
    ).toEqual(inFlight.map(() => [null, null]));
});
