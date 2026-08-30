/**
 * apps/action/e2e/helpers/enter-match.ts
 *
 * The shipped route into a match, as one call: main menu → Start → the game's
 * own `/select` page → Start → a revealed match.
 *
 * Every step is a click. There is no auto-start seam in this suite's fixture,
 * so this helper is not a shortcut around the production path — it IS the
 * production path, factored out of the specs that have to be past it before
 * they can assert anything.
 *
 * Module boundary: `@playwright/test` types and this suite's own page objects.
 */

import { expect, type Page } from '@playwright/test';
import { ActionInGameMenuPage } from '../pages/ActionInGameMenuPage';
import { ActionMainMenuPage } from '../pages/ActionMainMenuPage';
import { ActionMatchPage } from '../pages/ActionMatchPage';
import { ActionSelectPage } from '../pages/ActionSelectPage';

// The suite's WAIT BUDGETS, in one place so every spec waits the same amount for
// the same thing. CI runners are roughly an order slower than a developer
// machine, and the first shell load of a run also pays the game bundle's first
// parse — so these are generous. Bounded, though: a wait with no ceiling turns a
// hang into a 90 s spec timeout that says nothing about which step never
// finished.

/** Budget for the shell's first paint of the game menu on a cold CI runner. */
export const SHELL_LOAD_TIMEOUT_MS = 20_000;
/** Budget for one shell-to-shell route hop. */
export const NAV_TIMEOUT_MS = 15_000;
/** Budget for the whole `chimera:lobby:quick-start` sequence, plus the reveal. */
export const MATCH_ENTRY_TIMEOUT_MS = 60_000;

/** Walk the menu to the picker, leaving the window on `/select`. */
export async function openSelectPage(window: Page): Promise<ActionSelectPage> {
    const menu = new ActionMainMenuPage(window);
    await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
    await menu.startButton.click();

    const select = new ActionSelectPage(window);
    await expect(select.container).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    // The page writes the default host pick on mount, so waiting for the caption
    // is what makes the draft — not just the DOM — ready for the next step.
    await expect(select.hostPick).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    return select;
}

/**
 * Menu → picker → a revealed match, through the shipped UI throughout, on the
 * picker's DEFAULT pick.
 *
 * No options: a spec that wants a different pick — a second seat, a shape other
 * than the seeded one — has picker steps of its own to make between the two
 * Starts, so it drives `openSelectPage` and the reveal itself rather than
 * pushing its choices through a parameter here.
 */
export async function enterActionMatch(window: Page): Promise<ActionMatchPage> {
    const select = await openSelectPage(window);

    await select.start();
    // A refusal leaves the player on the picker and says so, so the failure to
    // report is that message rather than a canvas that never arrived.
    await expect(select.startFailed).toHaveCount(0);

    const match = new ActionMatchPage(window);
    await match.waitForRevealed(MATCH_ENTRY_TIMEOUT_MS);
    return match;
}

/**
 * The shipped exit: Escape → the engine's default in-game menu → Leave match.
 *
 * A quick-started session has no lobby to return to, so this exit ENDS it —
 * `closeSession({ autosave: true })`, capture and teardown in one call — and the
 * window lands back on the game's own main menu.
 */
export async function leaveActionMatch(window: Page): Promise<ActionMainMenuPage> {
    const inGameMenu = new ActionInGameMenuPage(window);
    await inGameMenu.openViaEscape();
    await inGameMenu.leave();

    const menu = new ActionMainMenuPage(window);
    await expect(window).toHaveURL(/\/main-menu\/?\?gameId=action$/, {
        timeout: MATCH_ENTRY_TIMEOUT_MS,
    });
    await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
    return menu;
}
