/**
 * F33B — game-result.spec.ts
 * §4.38 Game Resolution & Winner Detection
 *
 * Verifies winner propagation from tactics:attack through ActionPipeline,
 * StateProjector, PlayerSnapshot, and GameShell.
 */
import { test, expect } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

test.describe('Game result propagation', () => {
    test('host wins: host resolves win outcome and client resolves loss outcome', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);

        await hostGame.assertOldTacticsButtonsAbsent();
        await clientGame.assertOldTacticsButtonsAbsent();

        await hostGame.moveOwnedUnit();
        await hostGame.attackAdjacentEnemy();

        await expect(hostGame.gameResultBanner).toBeVisible({ timeout: 30_000 });
        await expect(clientGame.gameResultBanner).toBeVisible({ timeout: 30_000 });
        await expect(hostGame.gameResultBanner).toHaveAttribute('data-game-result-outcome', 'win');
        await expect(clientGame.gameResultBanner).toHaveAttribute(
            'data-game-result-outcome',
            'loss',
        );
    });

    test.describe('client first player', () => {
        test.use({ firstPlayer: 'client' });

        test('client wins: client resolves win outcome and host resolves loss outcome', async ({
            hostWindow,
            clientWindow,
        }) => {
            const hostGame = new GamePage(hostWindow);
            const clientGame = new GamePage(clientWindow);

            await hostGame.assertOldTacticsButtonsAbsent();
            await clientGame.assertOldTacticsButtonsAbsent();

            await clientGame.moveOwnedUnit();
            await clientGame.attackAdjacentEnemy();

            await expect(clientGame.gameResultBanner).toBeVisible({ timeout: 30_000 });
            await expect(hostGame.gameResultBanner).toBeVisible({ timeout: 30_000 });
            await expect(clientGame.gameResultBanner).toHaveAttribute(
                'data-game-result-outcome',
                'win',
            );
            await expect(hostGame.gameResultBanner).toHaveAttribute(
                'data-game-result-outcome',
                'loss',
            );
        });
    });
});
