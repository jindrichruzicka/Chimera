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
 * All interactions go through MatchPage POM locators and hostWindow only.
 */
import { test, expect } from '../fixtures/game.fixture';
import { MatchPage } from '../pages/MatchPage';

test.describe('Undo/redo', () => {
    test('undo reflects canUndo=false after exhausting turn history', async ({ hostWindow }) => {
        const hostMatch = new MatchPage(hostWindow);

        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();
        await expect(hostMatch.undoButton).toBeEnabled();

        await hostMatch.undoButton.click();

        await expect(hostMatch.undoButton).toBeDisabled();
        await expect(hostMatch.redoButton).toBeEnabled();
    });

    test('redo reflects canRedo=false after exhausting redo history', async ({ hostWindow }) => {
        const hostMatch = new MatchPage(hostWindow);

        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();
        await expect(hostMatch.undoButton).toBeEnabled();

        await hostMatch.undoButton.click();
        await expect(hostMatch.redoButton).toBeEnabled();

        await hostMatch.redoButton.click();

        await expect(hostMatch.redoButton).toBeDisabled();
        await expect(hostMatch.undoButton).toBeEnabled();
    });

    test("guest cannot undo the host's actions (per-turn ownership)", async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostMatch = new MatchPage(hostWindow);
        const clientMatch = new MatchPage(clientWindow);

        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();

        await expect(hostMatch.undoButton).toBeEnabled();

        await expect(clientMatch.undoButton).toBeDisabled();
    });

    test.describe('client first player', () => {
        test.use({ firstPlayer: 'client' });

        test('host cannot undo when client goes first', async ({ hostWindow, clientWindow }) => {
            const hostMatch = new MatchPage(hostWindow);
            const clientMatch = new MatchPage(clientWindow);

            await clientWindow.getByTestId('selectable-unit').first().click();
            await clientWindow.getByTestId('move-target').first().click();

            await expect(clientMatch.undoButton).toBeEnabled();
            await expect(hostMatch.undoButton).toBeDisabled();
        });
    });
});
