/**
 * replay-delete.spec.ts — deleting a saved replay from the browser.
 *
 * End-to-end coverage of the replay browser's per-row delete control, exercised
 * through the real renderer + main IPC path (not mocks):
 *   1. each replay row exposes a compact delete icon;
 *   2. clicking it opens a confirm dialog that deletes nothing until confirmed;
 *   3. Cancel dismisses the dialog and keeps every replay;
 *   4. Confirm deletes the targeted replay and drops its row from the list.
 *
 * Seeds real replays: a finished match auto-saves a perspective replay, and
 * saving from the player adds a deterministic one, so the browser lists at least
 * two rows to delete from (deleting one leaves the list still rendered).
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';
import { MainMenuPage } from '../pages/MainMenuPage';
import { ReplayPlayerPage } from '../pages/ReplayPlayerPage';

const TACTICS_GAME_ID = 'tactics';

// The preload exposes this on `globalThis.__chimera`; the e2e root tsconfig is
// DOM-less, so the slice this spec reaches through `page.evaluate` is typed here.
interface ChimeraReplayGlobal {
    readonly __chimera: {
        readonly replay: {
            readonly perspective: {
                list(gameId: string): Promise<readonly string[]>;
            };
        };
    };
}

/** Drive the host to game-over through the canonical move + attack flow. */
async function playToGameOver(hostGame: GamePage): Promise<void> {
    await hostGame.assertOwnedSelectionFeedbackChangesCanvas();
    await hostGame.moveSelectedPrimitiveNearOpponent();
    await hostGame.attackAdjacentEnemy();
    await expect(hostGame.gameResultBanner).toBeVisible({ timeout: 60_000 });
}

/** With the result banner showing, press Enter to reach the post-game summary. */
async function goToPostGameSummary(hostWindow: Page, hostGame: GamePage): Promise<void> {
    await expect.poll(() => hostGame.activeSceneId(), { timeout: 15_000 }).toBe('engine:game');
    await hostWindow.keyboard.press('Enter');
    await expect.poll(() => hostGame.activeScreenKey(), { timeout: 15_000 }).toBe('summary');
    await expect(hostGame.postGameSummary).toBeVisible();
}

/** Wait until the auto-finalised perspective replay (which gates Replays) is on disk. */
async function waitForPerspectiveReplaySaved(window: Page): Promise<void> {
    await expect
        .poll(
            () =>
                window.evaluate(
                    (gameId) =>
                        (globalThis as unknown as ChimeraReplayGlobal).__chimera.replay.perspective
                            .list(gameId)
                            .then((paths) => paths.length),
                    TACTICS_GAME_ID,
                ),
            { timeout: 15_000 },
        )
        .toBeGreaterThan(0);
}

test.describe('Replay browser — delete', () => {
    test('deletes a replay through the confirm dialog and drops its row', async ({
        hostWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);

        // Seed a deterministic replay (player save) alongside the auto-saved
        // perspective one, so the browser lists at least two rows.
        await hostGame.replayButton.click();
        const player = new ReplayPlayerPage(hostWindow);
        await expect(player.playButton).toBeVisible({ timeout: 30_000 });
        await expect(player.saveButton).toBeEnabled();
        await player.save();
        await waitForPerspectiveReplaySaved(hostWindow);

        // Reach the library the way a player does: main menu → Replays.
        const mainMenu = new MainMenuPage(hostWindow);
        await mainMenu.goto({ gameId: TACTICS_GAME_ID });
        await expect(mainMenu.replaysButton).toBeEnabled();
        await mainMenu.replaysButton.click();
        await expect(hostWindow.getByTestId('replays-page')).toBeVisible();

        // The page container renders during its async loading state too, so wait
        // for the list itself to render before the one-shot count() — reading it
        // while still loading returns 0 (the source of an earlier flake).
        const rows = hostWindow.getByTestId('replay-open-btn');
        await expect(rows.first()).toBeVisible({ timeout: 15_000 });
        const initialCount = await rows.count();
        expect(initialCount).toBeGreaterThan(0);

        // Clicking delete opens the confirm dialog but deletes nothing yet.
        await hostWindow.getByTestId('replay-delete-btn').first().click();
        await expect(hostWindow.getByTestId('replay-delete-dialog')).toBeVisible();

        // Cancel dismisses the dialog and keeps every replay.
        await hostWindow.getByTestId('replay-delete-cancel').click();
        await expect(hostWindow.getByTestId('replay-delete-dialog')).toHaveCount(0);
        await expect(rows).toHaveCount(initialCount);

        // Re-open and confirm — the targeted replay is deleted and its row drops.
        await hostWindow.getByTestId('replay-delete-btn').first().click();
        await expect(hostWindow.getByTestId('replay-delete-dialog')).toBeVisible();
        await hostWindow.getByTestId('replay-delete-confirm').click();

        await expect(rows).toHaveCount(initialCount - 1);
    });
});
