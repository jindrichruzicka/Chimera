/**
 * in-scene-selection.spec.ts
 * §4.37.9 — the interactive shell background
 *
 * The opt-in that makes the menu scene CLICKABLE, and the bill it comes with.
 *
 * Under `shellBackgroundInteractive` the engine's layers stand aside and the
 * background host stops refusing pointer events — so a click can reach a
 * primitive in the canvas. The same flip is what could quietly break every
 * control on top of it: a transparent `pointer-events: auto` plate still eats a
 * click. So this file has two halves, and the second is the one that would catch
 * a regression nobody would see in a screenshot.
 *
 *   1. PICKING — a click in the scene moves the host seat's ring, and so do the
 *      seat's own rebindable movement keys, before any match exists.
 *   2. THE CLICK-THROUGH SWEEP — the menu's four entries, the confirm surface's
 *      two, the picker's toggle and Back, and the settings tab and Close: each
 *      clicked, and its EFFECT asserted. An assertion that a control is merely
 *      visible would pass with the plate swallowing every click. The plate is
 *      re-checked as mounted on each surface before that surface's controls are
 *      swept, so "with the background mounted" is a fact about every click
 *      rather than about the first one.
 *
 * The picks are read from the `/select` page's captions rather than from the
 * rings, because a ring is drawn in WebGL and the caption is the same draft
 * rendered as text — the only readable form the pick has.
 */

import { expect, test } from '../fixtures/electron.fixture';
import { SYSTEM_QUIT_CHANNEL } from '../../../../electron/preload/apis/system-api';
import {
    enterActionMatch,
    leaveActionMatch,
    MATCH_ENTRY_TIMEOUT_MS,
    NAV_TIMEOUT_MS,
    openSelectPage,
    SHELL_LOAD_TIMEOUT_MS,
} from '../helpers/enter-match';
import { ActionMainMenuPage } from '../pages/ActionMainMenuPage';
import { ActionMatchPage } from '../pages/ActionMatchPage';
import { ActionSelectPage } from '../pages/ActionSelectPage';
import { ActionSettingsPage } from '../pages/ActionSettingsPage';
import { ActionShellBackgroundPage } from '../pages/ActionShellBackgroundPage';

test.use({ actionPort: '7816' });

/** Where the sweep's Quit step parks its observation, in the main process. */
const QUIT_OBSERVED_KEY = '__actionSweepQuitObserved';

test.describe('Action in-scene selection', () => {
    test('a click in the scene and the movement keys both move the host’s pick', async ({
        mainWindow,
    }) => {
        test.slow();

        const select = await openSelectPage(mainWindow);
        const background = new ActionShellBackgroundPage(mainWindow);
        await background.waitForGameBackground(NAV_TIMEOUT_MS);

        // The page's own mount write: the first seeded shape, so a player who
        // never touches the picker starts on the primitive the seat-order
        // fallback would have given them anyway.
        await expect(select.hostPick).toHaveText(/cube$/, { timeout: NAV_TIMEOUT_MS });

        // ── The mouse ────────────────────────────────────────────────────────
        // Dead centre of the plate. The shell camera's home framing looks at the
        // middle seeded primitive's own centre, so the ray from the middle of
        // the viewport lands on the sphere and nothing else — which is why this
        // asserts a NAMED shape rather than "the pick changed".
        await background.clickSceneCentre();
        await expect(select.hostPick).toHaveText(/sphere$/, { timeout: NAV_TIMEOUT_MS });

        // Shell-state discipline (Invariant #139): the click moved a DRAFT and
        // nothing else. No match was opened, and the window did not move.
        await expect(mainWindow).toHaveURL(/\/select\/?\?gameId=action$/);
        await expect(new ActionMatchPage(mainWindow).canvas).toHaveCount(0);

        // ── The keys ─────────────────────────────────────────────────────────
        // The seat's own rebindable movement actions, registered at app boot off
        // the shell payload — so they work here, before any match has run.
        await select.stepHostPick('right');
        await expect(select.hostPick).toHaveText(/cone$/, { timeout: NAV_TIMEOUT_MS });
        await select.stepHostPick('left');
        await expect(select.hostPick).toHaveText(/sphere$/, { timeout: NAV_TIMEOUT_MS });
    });

    test('the swept shell controls still take their clicks with the background mounted', async ({
        electronApp,
        mainWindow,
    }) => {
        test.slow();

        const menu = new ActionMainMenuPage(mainWindow);
        const select = new ActionSelectPage(mainWindow);
        const settings = new ActionSettingsPage(mainWindow);
        const background = new ActionShellBackgroundPage(mainWindow);
        const match = new ActionMatchPage(mainWindow);
        const confirmDialog = mainWindow.getByTestId('confirm-dialog');

        // Arrange: an autosave, so Continue is live and Start asks — the two
        // menu entries a fresh profile cannot exercise at all.
        await enterActionMatch(mainWindow);
        await leaveActionMatch(mainWindow);
        await expect(menu.continueButton).toBeEnabled({ timeout: NAV_TIMEOUT_MS });

        // Every click below is made with the game's own interactive plate
        // mounted underneath, which is the whole point of the sweep.
        await background.waitForGameBackground(SHELL_LOAD_TIMEOUT_MS);

        // 1. main menu → Settings
        await menu.settingsButton.click();
        await expect(mainWindow).toHaveURL(/\/settings\/?\?gameId=action$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await background.waitForGameBackground(NAV_TIMEOUT_MS);

        // 2. settings → a tab
        await settings.openControlsTab();
        await expect(settings.bindingRow('game:move-up')).toBeVisible({ timeout: NAV_TIMEOUT_MS });

        // 3. settings → Close
        await settings.close();
        await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=action$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
        await background.waitForGameBackground(SHELL_LOAD_TIMEOUT_MS);

        // 4. main menu → Continue (the engine verb, not a navigation)
        await menu.continueButton.click();
        await match.waitForRevealed(MATCH_ENTRY_TIMEOUT_MS);
        await leaveActionMatch(mainWindow);
        await background.waitForGameBackground(SHELL_LOAD_TIMEOUT_MS);

        // 5. main menu → Start, and the confirm surface it opens
        await menu.startButton.click();
        await expect(confirmDialog).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        // 6. the dialog's own two controls — cancel first, so both are swept
        await mainWindow.getByTestId('confirm-dialog-cancel').click();
        await expect(confirmDialog).toHaveCount(0, { timeout: NAV_TIMEOUT_MS });
        await menu.startButton.click();
        await mainWindow.getByTestId('confirm-dialog-confirm').click();
        await expect(select.container).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await background.waitForGameBackground(NAV_TIMEOUT_MS);

        // 7. /select → the second-player toggle
        await select.enableSecondPlayer();
        await expect(select.secondPick).toBeVisible({ timeout: NAV_TIMEOUT_MS });

        // 8. /select → Back
        await select.backButton.click();
        await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=action$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);

        // 9. main menu → Quit. Last, because its effect is the end of the app.
        //    What is asserted is the IPC the click sends rather than the process
        //    exiting: `system.quit()` over the preload-declared quit channel IS
        //    the whole of the button's behaviour, so a listener on that channel
        //    answers "the click landed" — which is what this sweep is about —
        //    without racing the teardown it starts.
        await electronApp.evaluate(
            ({ ipcMain }, params) => {
                Object.defineProperty(globalThis, params.observedKey, {
                    configurable: true,
                    value: false,
                    writable: true,
                });
                ipcMain.once(params.quitChannel, () => {
                    Object.defineProperty(globalThis, params.observedKey, {
                        configurable: true,
                        value: true,
                        writable: true,
                    });
                });
            },
            { observedKey: QUIT_OBSERVED_KEY, quitChannel: SYSTEM_QUIT_CHANNEL },
        );

        await menu.quitButton.click();

        await expect
            .poll(
                () =>
                    electronApp.evaluate(
                        (_electron, observedKey) =>
                            Object.getOwnPropertyDescriptor(globalThis, observedKey)?.value ===
                            true,
                        QUIT_OBSERVED_KEY,
                    ),
                { timeout: NAV_TIMEOUT_MS },
            )
            .toBe(true);
    });
});
