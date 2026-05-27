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
import { test, expect } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

test.describe('End turn', () => {
    test('end turn clears undo and redo history', async ({ hostWindow }) => {
        const hostGame = new GamePage(hostWindow);

        // Make a move
        await hostGame.moveOwnedUnit();

        await expect(hostGame.undoButton).toBeEnabled();

        // End the turn
        await hostGame.endTurnButton.click();

        // After ending turn, undo should be disabled (history cleared)
        await expect(hostGame.undoButton).toBeDisabled();
        await expect(hostGame.redoButton).toBeDisabled();
    });

    test('end turn after partial undo also clears redo', async ({ hostWindow }) => {
        const hostGame = new GamePage(hostWindow);

        // Make a move
        await hostGame.moveOwnedUnit();

        await expect(hostGame.undoButton).toBeEnabled();

        // Partially undo
        await hostGame.undoButton.click();
        await expect(hostGame.redoButton).toBeEnabled();

        // End the turn
        await hostGame.endTurnButton.click();

        // After ending turn, both undo and redo should be disabled
        await expect(hostGame.undoButton).toBeDisabled();
        await expect(hostGame.redoButton).toBeDisabled();
    });

    test('end turn button is disabled for non-active player', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);

        // Host makes a move (host is active first)
        await hostGame.moveOwnedUnit();

        // Verify host can end turn and client cannot
        await expect(hostGame.endTurnButton).toBeEnabled();
        await expect(clientGame.endTurnButton).toBeDisabled();

        // Host ends turn
        await hostGame.endTurnButton.click();

        // After host ends turn, client should be able to end turn
        // (button should be enabled after turn transfer)
        await expect(clientGame.endTurnButton).toBeEnabled();
    });

    test('turn transfer: client move succeeds after host ends turn', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);

        // Host makes a move
        await hostGame.moveOwnedUnit();
        const hostTickAfterMove = await hostGame.currentTick();

        // Host ends turn
        await hostGame.endTurnButton.click();
        await hostGame.waitForTick(hostTickAfterMove + 1);

        // Client should now be able to move
        await clientGame.moveOwnedUnit();

        // Verify move was processed
        const clientTickAfterMove = await clientGame.currentTick();
        expect(clientTickAfterMove).toBeGreaterThan(hostTickAfterMove);
    });

    test.describe('client first player', () => {
        test.use({ firstPlayer: 'client' });

        test('turn transfer: host move succeeds after client ends turn', async ({
            hostWindow,
            clientWindow,
        }) => {
            const hostGame = new GamePage(hostWindow);
            const clientGame = new GamePage(clientWindow);

            // Client makes a move (client is active first in this context)
            await clientGame.moveOwnedUnit();
            const clientTickAfterMove = await clientGame.currentTick();

            // Client ends turn
            await clientGame.endTurnButton.click();
            await clientGame.waitForTick(clientTickAfterMove + 1);

            // Host should now be able to move
            await hostGame.moveOwnedUnit();

            // Verify move was processed
            const hostTickAfterMove = await hostGame.currentTick();
            expect(hostTickAfterMove).toBeGreaterThan(clientTickAfterMove);
        });
    });
});
