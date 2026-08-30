/**
 * menu-flow.spec.ts
 * §4.37 Renderer Shell Pages UI Contract · §13 E2E Testing (Playwright)
 *
 * The action app's front door, on a profile that has never played: what the
 * menu offers, what it refuses, and what it is drawn over.
 *
 * Driven entirely through the SHIPPED UI — the app boots where production boots
 * it, at `/main-menu/?gameId=action`, and every step below is a click a player
 * makes. The `CHIMERA_E2E` auto-start latch is deliberately unavailable in this
 * suite's fixture, so a spec cannot accidentally skip the surface it is proving.
 *
 * What this proves:
 *   1. The GAME's menu renders, not the engine default — four entries, in the
 *      order the definition declares them.
 *   2. Continue is DISABLED on a fresh profile, and the engine's own
 *      availability gate is what answers: the action definition declares no
 *      `disabled` for it at all, so an enabled Continue here would mean the gate
 *      never ran.
 *   3. Start SKIPS the confirmation while there is no autosave to overwrite —
 *      `when: 'autosave-exists'` — and lands on the game's own `/select` page.
 *   4. The menu is drawn over this game's LIVE background, not the engine's
 *      solid plate.
 */

import { expect, test } from '../fixtures/electron.fixture';
import {
    enterActionMatch,
    MATCH_ENTRY_TIMEOUT_MS,
    NAV_TIMEOUT_MS,
    SHELL_LOAD_TIMEOUT_MS,
} from '../helpers/enter-match';
import { installRouteTrace, readRouteTrace, visitedRoutePaths } from '../helpers/route-trace';
import { ActionMainMenuPage } from '../pages/ActionMainMenuPage';
import { ActionSelectPage } from '../pages/ActionSelectPage';
import { ActionShellBackgroundPage } from '../pages/ActionShellBackgroundPage';

test.use({ actionPort: '7811' });

test.describe('Action main menu on a fresh profile', () => {
    test('renders the game’s own four entries over its live background', async ({ mainWindow }) => {
        const menu = new ActionMainMenuPage(mainWindow);
        const background = new ActionShellBackgroundPage(mainWindow);

        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);

        // The definition's own order, and its own labels — the engine default
        // would read Play / Settings / Quit and carry no Continue at all.
        expect(await menu.buttonLabels()).toEqual(['Continue', 'Start', 'Settings', 'Quit']);

        // …and the plate under it is this GAME's scene. `kind` is the engine's
        // classification of what it mounted, so `'game'` is the fact that the
        // shell payload's `shellBackground` arrived; the scene testid is this
        // app's own component confirming which one.
        await expect(background.host).toHaveAttribute('data-shell-background-kind', 'game', {
            timeout: SHELL_LOAD_TIMEOUT_MS,
        });
        await expect(background.host).toHaveAttribute('data-shell-game-id', 'action');
        await expect(background.scene).toBeVisible();
    });

    test('holds Continue disabled with nothing to continue, and offers Start', async ({
        mainWindow,
    }) => {
        const menu = new ActionMainMenuPage(mainWindow);
        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);

        // The engine's availability gate answers for Continue: this profile has
        // never saved. The action definition declares no `disabled` for the
        // entry, so an enabled button here would mean the gate never ran.
        await expect(menu.continueButton).toBeVisible();
        await expect(menu.continueButton).toBeDisabled();
        await expect(menu.startButton).toBeEnabled();
    });

    test('Start skips the overwrite confirm and opens the game’s own /select page', async ({
        mainWindow,
    }) => {
        const menu = new ActionMainMenuPage(mainWindow);
        const select = new ActionSelectPage(mainWindow);

        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
        await menu.startButton.click();

        // Straight through: the declared confirm is `when: 'autosave-exists'`,
        // and a first-run player has nothing to overwrite, so being told they do
        // would be a lie the engine is responsible for not telling.
        await expect(mainWindow.getByTestId('confirm-dialog')).toHaveCount(0);
        await expect(select.container).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await expect(mainWindow).toHaveURL(/\/select\/?\?gameId=action$/);
    });

    test('the way into a match never passes through /lobby', async ({ mainWindow }) => {
        test.slow();

        // Armed on the menu, BEFORE the first click, and recording from inside
        // the page — because what this measures has already ended by the time an
        // out-of-process assertion could look. `toHaveURL` samples the URL that
        // is current when it runs, so a lobby entered and left within one commit
        // would never appear in any sample it could take. Every hop below is a
        // client-side push, which is what the recorder survives.
        await new ActionMainMenuPage(mainWindow).waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
        await installRouteTrace(mainWindow);

        await enterActionMatch(mainWindow);
        await expect(mainWindow).toHaveURL(/\/game\/?\?gameId=action$/, {
            timeout: MATCH_ENTRY_TIMEOUT_MS,
        });

        const trace = await readRouteTrace(mainWindow);
        const context = `route trace: ${JSON.stringify(trace)}`;
        // The whole journey, not a sampled endpoint. This app declares no lobby
        // entry at all, and the match is opened by the real
        // `chimera:lobby:quick-start` verb from the game's own page — so a
        // `/lobby` anywhere in this list would mean the shipped path is not the
        // one the menu advertises.
        expect(visitedRoutePaths(trace), context).toEqual(['/main-menu', '/select', '/game']);
        // And the game context rode every hop — a dropped `?gameId=` lands the
        // player on the engine-default menu on the way back out.
        expect(
            trace.every((url) => url.includes('gameId=action')),
            context,
        ).toBe(true);
    });
});
