/**
 * F33 — game-flow.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies the full game lifecycle:
 *   - Host resolves the game through the normal attack action
 *   - Both host and client windows reach the game-over state
 *
 * The game.fixture handles the full lobby → game transition; this spec
 * drives the in-game action that resolves the end state.
 *
 * Invariant #42: GameSnapshot.tick increments by exactly 1 per action —
 * the game must reach game-over through normal pipeline processing,
 * never by directly mutating tick.
 */
import { test, expect } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';

test.describe('Game flow', () => {
    test('host and client reach game-over state through canvas movement and attack', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);

        await hostGame.assertOwnedSelectionFeedbackChangesCanvas();
        await hostGame.moveSelectedPrimitiveNearOpponent();
        await hostGame.attackAdjacentEnemy();

        await expect(hostGame.gameResultBanner).toBeVisible({ timeout: 60_000 });
        await expect(clientGame.gameResultBanner).toBeVisible({ timeout: 60_000 });
    });
});
