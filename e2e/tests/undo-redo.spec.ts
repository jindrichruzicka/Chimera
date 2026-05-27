/**
 * F33 — undo-redo.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies undo/redo history reflects ActionPipeline state:
 *   - After one move action + undo: undoButton is disabled, redoButton is enabled
 *   - After one move action + undo + redo: redoButton is disabled, undoButton is enabled
 *   - Guest cannot undo the host's actions (per-turn ownership enforcement, BLOCK-2 fix)
 *   - Host cannot undo the client's first action when client is configured to go first
 *
 * Invariant #7: engine:undo/engine:redo go through the normal ActionPipeline —
 * the spec verifies the UI reflects canUndo=false / canRedo=false, proving no
 * side-door undo/redo path was taken.
 *
 * All interactions go through GamePage POM locators and hostWindow only.
 */
import { test, expect } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

test.describe('Undo/redo', () => {
    test('undo reflects canUndo=false after exhausting turn history', async ({ hostWindow }) => {
        const hostGame = new GamePage(hostWindow);

        await hostGame.moveOwnedUnit();
        await expect(hostGame.undoButton).toBeEnabled();

        await hostGame.undoButton.click();

        await expect(hostGame.undoButton).toBeDisabled();
        await expect(hostGame.redoButton).toBeEnabled();
    });

    test('redo reflects canRedo=false after exhausting redo history', async ({ hostWindow }) => {
        const hostGame = new GamePage(hostWindow);

        await hostGame.moveOwnedUnit();
        await expect(hostGame.undoButton).toBeEnabled();

        await hostGame.undoButton.click();
        await expect(hostGame.redoButton).toBeEnabled();

        await hostGame.redoButton.click();

        await expect(hostGame.redoButton).toBeDisabled();
        await expect(hostGame.undoButton).toBeEnabled();
    });

    test("guest cannot undo the host's actions (per-turn ownership)", async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);

        await hostGame.moveOwnedUnit();

        await expect(hostGame.undoButton).toBeEnabled();

        await expect(clientGame.undoButton).toBeDisabled();
    });

    test.describe('client first player', () => {
        test.use({ firstPlayer: 'client' });

        test('host cannot undo when client goes first', async ({ hostWindow, clientWindow }) => {
            const hostGame = new GamePage(hostWindow);
            const clientGame = new GamePage(clientWindow);

            await expect(clientGame.endTurnButton).toBeEnabled();
            const tickBeforeMove = await clientGame.currentTick();

            await clientGame.moveOwnedUnit();
            await clientGame.waitForTick(tickBeforeMove + 1);

            await expect(clientGame.undoButton).toBeEnabled();
            await expect(hostGame.undoButton).toBeDisabled();
        });
    });
});
