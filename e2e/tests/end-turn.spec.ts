/**
 * F33 — end-turn.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies end-turn button behavior and turn mechanics:
 *   - End turn clears undo history
 *   - End turn after partial undo also clears redo history
 *   - End turn button is disabled for non-active player
 *   - Turn transfer: client move succeeds after host ends turn (host goes first)
 *   - Turn transfer (client-first): host move succeeds after client ends turn (client goes first)
 *
 * Invariant #8: engine:end_turn goes through the normal ActionPipeline —
 * the spec verifies button state and history clearing, proving the implementation
 * follows the deterministic state machine.
 *
 * Invariant #3: PlayerSnapshot.isMyTurn computed from turnClock; button disabled
 * when isMyTurn === false (non-active players cannot end turn).
 */
import { test, expect } from '../fixtures/direct-match.fixture';
import { MatchPage } from '../pages/MatchPage';

test.describe('End turn', () => {
    test('end turn clears undo and redo history', async ({ hostWindow }) => {
        const hostMatch = new MatchPage(hostWindow);

        // Make a move
        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();

        await expect(hostMatch.undoButton).toBeEnabled();

        // End the turn
        await hostMatch.endTurnButton.click();

        // After ending turn, undo should be disabled (history cleared)
        await expect(hostMatch.undoButton).toBeDisabled();
        await expect(hostMatch.redoButton).toBeDisabled();
    });

    test('end turn after partial undo also clears redo', async ({ hostWindow }) => {
        const hostMatch = new MatchPage(hostWindow);

        // Make a move
        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();

        await expect(hostMatch.undoButton).toBeEnabled();

        // Partially undo
        await hostMatch.undoButton.click();
        await expect(hostMatch.redoButton).toBeEnabled();

        // End the turn
        await hostMatch.endTurnButton.click();

        // After ending turn, both undo and redo should be disabled
        await expect(hostMatch.undoButton).toBeDisabled();
        await expect(hostMatch.redoButton).toBeDisabled();
    });

    test('end turn button is disabled for non-active player', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostMatch = new MatchPage(hostWindow);
        const clientMatch = new MatchPage(clientWindow);

        // Host makes a move (host is active first)
        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();

        // Verify host can end turn and client cannot
        await expect(hostMatch.endTurnButton).toBeEnabled();
        await expect(clientMatch.endTurnButton).toBeDisabled();

        // Host ends turn
        await hostMatch.endTurnButton.click();

        // After host ends turn, client should be able to end turn
        // (button should be enabled after turn transfer)
        await expect(clientMatch.endTurnButton).toBeEnabled();
    });

    test('turn transfer: client move succeeds after host ends turn', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostMatch = new MatchPage(hostWindow);
        const clientMatch = new MatchPage(clientWindow);

        // Host makes a move
        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();
        const hostTickAfterMove = await hostMatch.currentTick();

        // Host ends turn
        await hostMatch.endTurnButton.click();
        await hostMatch.waitForTick(hostTickAfterMove + 1);

        // Client should now be able to move
        await clientWindow.getByTestId('selectable-unit').first().click();
        await clientWindow.getByTestId('move-target').first().click();

        // Verify move was processed
        const clientTickAfterMove = await clientMatch.currentTick();
        expect(clientTickAfterMove).toBeGreaterThan(hostTickAfterMove);
    });

    test.describe('client first player', () => {
        test.use({ firstPlayer: 'client' });

        test('turn transfer: host move succeeds after client ends turn', async ({
            hostWindow,
            clientWindow,
        }) => {
            const hostMatch = new MatchPage(hostWindow);
            const clientMatch = new MatchPage(clientWindow);

            // Client makes a move (client is active first in this context)
            await clientWindow.getByTestId('selectable-unit').first().click();
            await clientWindow.getByTestId('move-target').first().click();
            const clientTickAfterMove = await clientMatch.currentTick();

            // Client ends turn
            await clientMatch.endTurnButton.click();
            await clientMatch.waitForTick(clientTickAfterMove + 1);

            // Host should now be able to move
            await hostWindow.getByTestId('selectable-unit').first().click();
            await hostWindow.getByTestId('move-target').first().click();

            // Verify move was processed
            const hostTickAfterMove = await hostMatch.currentTick();
            expect(hostTickAfterMove).toBeGreaterThan(clientTickAfterMove);
        });
    });
});
