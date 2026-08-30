/**
 * start-warning.spec.ts
 * §4.37 Renderer Shell Pages UI Contract · Invariant #140 (one confirm surface)
 *
 * The other half of `confirm: { when: 'autosave-exists' }` — the half
 * `menu-flow.spec.ts` cannot reach, because it runs on a profile that has never
 * saved.
 *
 * Once an autosave exists, Start is a destructive action: it opens the picker
 * for a NEW run, and the run the player left is what would be overwritten. So
 * the engine asks — through the ONE confirm surface, with the game's own copy —
 * and both answers are asserted, because a dialog that proceeds on cancel is
 * worse than no dialog at all.
 *
 * CANCEL IS THE INTERESTING ONE. It has to leave two things untouched: the
 * window (still on the menu, never on `/select`) and the SAVE (Continue still
 * enabled, so the run is still resumable). A cancel that navigated, or one that
 * quietly cleared the slot, would both read as "the dialog worked".
 */

import { expect, test } from '../fixtures/electron.fixture';
import {
    enterActionMatch,
    leaveActionMatch,
    NAV_TIMEOUT_MS,
    SHELL_LOAD_TIMEOUT_MS,
} from '../helpers/enter-match';
import { ActionSelectPage } from '../pages/ActionSelectPage';

test.use({ actionPort: '7814' });

test.describe('Action Start confirmation with an autosave present', () => {
    test('asks before overwriting, keeps everything on cancel, and proceeds on confirm', async ({
        mainWindow,
    }) => {
        test.slow();

        // ── Arrange: create the autosave through the shipped exit ────────────
        await enterActionMatch(mainWindow);
        const menu = await leaveActionMatch(mainWindow);
        await expect(menu.continueButton).toBeEnabled({ timeout: NAV_TIMEOUT_MS });

        const select = new ActionSelectPage(mainWindow);
        const confirmDialog = mainWindow.getByTestId('confirm-dialog');

        // ── 1. Start now ASKS, in this game's words ──────────────────────────
        await menu.startButton.click();
        await expect(confirmDialog).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        // The game's declared copy, resolved through its own translation bundle —
        // an engine-default question here would mean the declaration never
        // reached the confirm.
        await expect(
            confirmDialog.getByRole('heading', { name: 'Start a new run?' }),
        ).toBeVisible();
        await expect(mainWindow.getByTestId('confirm-dialog-body')).toHaveText(
            'Starting anew clears the progress your autosave is holding.',
        );
        await expect(mainWindow.getByTestId('confirm-dialog-confirm')).toHaveText('Start anew');
        // Nothing has happened yet: the question sits between the click and the
        // action.
        await expect(select.container).toHaveCount(0);

        // ── 2. Cancel keeps the menu AND the save ────────────────────────────
        await mainWindow.getByTestId('confirm-dialog-cancel').click();
        await expect(confirmDialog).toHaveCount(0, { timeout: NAV_TIMEOUT_MS });
        await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=action$/);
        await expect(select.container).toHaveCount(0);
        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
        // The save is still there — the refused Start cleared nothing, so the
        // run the player was protecting is still resumable.
        await expect(menu.continueButton).toBeEnabled();

        // ── 3. Confirm proceeds ──────────────────────────────────────────────
        await menu.startButton.click();
        await expect(confirmDialog).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await mainWindow.getByTestId('confirm-dialog-confirm').click();
        await expect(select.container).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await expect(mainWindow).toHaveURL(/\/select\/?\?gameId=action$/);
    });
});
