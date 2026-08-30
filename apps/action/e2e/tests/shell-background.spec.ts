/**
 * shell-background.spec.ts
 * §4.37.9 / §4.37.18 — the live shell background and what it reacts to
 *
 * Two claims, and they are about different things.
 *
 * PERSISTENCE is about the MOUNT: one live scene, carried unbroken across
 * `/main-menu → /select → /settings → /main-menu`. The engine mints an instance
 * id per mount, so an id that survives every hop is the proof — where a
 * "background is visible on each screen" assertion would be equally true of a
 * scene torn down and rebuilt behind each one, which is the failure the pinned
 * surface set exists to prevent.
 *
 * REACTIVITY is about the CAMERA, and it is read through the phase attributes
 * the rig publishes. A WebGL camera transform is not observable from the DOM at
 * all, and the CSS around it is frozen under Playwright-Electron — so those
 * attributes are the only honest reader, which is why the rig writes them.
 *
 * The dolly is RECORDED rather than sampled. Its whole visible window is bounded
 * by the quick start's IPC round trip, and the background is unmounted the moment
 * the match surface lands: a poll that looked between two samples would report a
 * phase that was published and replaced as one that never happened.
 */

import { expect, test } from '../fixtures/electron.fixture';
import {
    ACTION_SHELL_DOLLY_ATTRIBUTE,
    ACTION_SHELL_YAW_ATTRIBUTE,
} from '@chimera-engine/action/shell/actionShellCamera.js';
import {
    installAttributeTimeline,
    readAttributeTimeline,
    valuesOf,
} from '../helpers/attribute-timeline';
import {
    MATCH_ENTRY_TIMEOUT_MS,
    NAV_TIMEOUT_MS,
    openSelectPage,
    SHELL_LOAD_TIMEOUT_MS,
} from '../helpers/enter-match';
import { ActionMainMenuPage } from '../pages/ActionMainMenuPage';
import { ActionMatchPage } from '../pages/ActionMatchPage';
import { ActionSettingsPage } from '../pages/ActionSettingsPage';
import {
    ACTION_SHELL_SCENE_SELECTOR,
    ActionShellBackgroundPage,
} from '../pages/ActionShellBackgroundPage';

test.use({ actionPort: '7815' });

/** The background's own yaw clock is 600 ms; give a slow runner room around it. */
const CAMERA_TIMEOUT_MS = 15_000;

test.describe('Action shell background', () => {
    test('one live scene survives menu → select → settings → menu', async ({ mainWindow }) => {
        test.slow();

        const menu = new ActionMainMenuPage(mainWindow);
        const background = new ActionShellBackgroundPage(mainWindow);
        const settings = new ActionSettingsPage(mainWindow);

        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
        await background.waitForGameBackground(SHELL_LOAD_TIMEOUT_MS);
        const mounted = await background.instanceId();

        // → the GAME-owned page. It is a physical Next route, and it is
        // `shellRoutes` that classifies it as a background surface — an
        // undeclared route would drop the plate on arrival and mint a new id on
        // the way back.
        await openSelectPage(mainWindow);
        await background.waitForGameBackground(NAV_TIMEOUT_MS);
        expect(await background.instanceId()).toBe(mounted);

        // → settings, an ENGINE screen, reached from the game's own page.
        await mainWindow.goBack();
        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
        await menu.settingsButton.click();
        await expect(mainWindow).toHaveURL(/\/settings\/?\?gameId=action$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await background.waitForGameBackground(NAV_TIMEOUT_MS);
        expect(await background.instanceId()).toBe(mounted);

        // → and back.
        await settings.close();
        await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=action$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await background.waitForGameBackground(NAV_TIMEOUT_MS);
        expect(await background.instanceId()).toBe(mounted);
    });

    test('the camera yaws away on Settings and comes home again', async ({ mainWindow }) => {
        test.slow();

        const menu = new ActionMainMenuPage(mainWindow);
        const background = new ActionShellBackgroundPage(mainWindow);
        const settings = new ActionSettingsPage(mainWindow);

        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
        await background.waitForGameBackground(SHELL_LOAD_TIMEOUT_MS);
        // The opening pose is published before the first frame, so "at home" is
        // a fact here rather than "no phase written yet".
        await background.expectYaw('home', CAMERA_TIMEOUT_MS);
        await background.expectDolly('wide', CAMERA_TIMEOUT_MS);

        await menu.settingsButton.click();
        await expect(mainWindow).toHaveURL(/\/settings\/?\?gameId=action$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        // The surface — not the route string — is what the rig reads, and the
        // yaw runs on the background's OWN clock rather than on the screen fade,
        // which this build collapses to zero.
        await background.expectYaw('away', CAMERA_TIMEOUT_MS);
        // …and the other axis did not move with it. The pose is two independent
        // fractions, so a single-enum model that dragged the dolly along would
        // show up right here.
        await background.expectDolly('wide', CAMERA_TIMEOUT_MS);

        await settings.close();
        await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=action$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await background.expectYaw('home', CAMERA_TIMEOUT_MS);
    });

    test('the dolly stays wide on the shell, and follows the ARMED entry when a frame lands', async ({
        mainWindow,
    }) => {
        test.slow();

        const select = await openSelectPage(mainWindow);
        const background = new ActionShellBackgroundPage(mainWindow);
        await background.waitForGameBackground(NAV_TIMEOUT_MS);
        await background.expectDolly('wide', CAMERA_TIMEOUT_MS);

        // Armed BEFORE the click, and recording from inside the page: the whole
        // window this measures closes when the match surface replaces the
        // background.
        await installAttributeTimeline(mainWindow, ACTION_SHELL_SCENE_SELECTOR, [
            ACTION_SHELL_YAW_ATTRIBUTE,
            ACTION_SHELL_DOLLY_ATTRIBUTE,
        ]);

        await select.start();
        await new ActionMatchPage(mainWindow).waitForRevealed(MATCH_ENTRY_TIMEOUT_MS);

        const timeline = await readAttributeTimeline(mainWindow);
        const context = `camera timeline: ${JSON.stringify(timeline)}`;
        const dolly = valuesOf(timeline, ACTION_SHELL_DOLLY_ATTRIBUTE);

        // It was wide on the shell, and every later value it took was `close` —
        // the only pose an armed `to-match` transition calls for.
        //
        // "Every value it took" rather than "it reached close", deliberately,
        // and the difference is a measurement rather than caution.
        //
        // This build collapses the screen fade to 0 ms, and the whole entry —
        // click to the `/game` push — takes 25-40 ms end to end (timestamped in
        // the page: the arm and the push are that far apart). The dolly's
        // outward leg is timed BY that fade, so it has no ramp to run; it snaps
        // on the first frame that lands inside that window, and the main thread
        // is busy with the route transition for much of it. Across three local
        // repeat-runs of this spec the write was recorded in 3 of 4, then 3 of
        // 6, then 1 of 4 entries — so asserting the arrival would be asserting
        // the scheduler.
        //
        // What the list below does hold, either way, is that `close` is the only
        // thing the dolly ever became: a ramp caught mid-flight would leave a
        // `moving` here, and the arrival itself is the rig's own unit test's.
        expect(dolly[0], context).toBe('wide');
        expect(dolly.slice(1), context).toEqual(dolly.slice(1).map(() => 'close'));
        // The yaw is a separate axis and had no reason to move: nothing here went
        // near Settings. A single-enum pose model would have dragged it along.
        expect(valuesOf(timeline, ACTION_SHELL_YAW_ATTRIBUTE), context).toEqual(['home']);
    });
});
