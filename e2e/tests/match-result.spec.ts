/**
 * F33B — match-result.spec.ts
 * §4.38 Match Resolution & Winner Detection
 *
 * Verifies winner propagation from tactics:attack through ActionPipeline,
 * StateProjector, PlayerSnapshot, and MatchShell.
 */
import { test, expect } from '../fixtures/direct-match.fixture';
import { MatchPage } from '../pages/MatchPage';

test.describe('Match result propagation', () => {
    test('host wins: host sees You won and client sees You lose', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostMatch = new MatchPage(hostWindow);
        const clientMatch = new MatchPage(clientWindow);

        await hostMatch.attackAdjacentEnemy();

        await expect(hostMatch.matchResultBanner).toBeVisible({ timeout: 30_000 });
        await expect(clientMatch.matchResultBanner).toBeVisible({ timeout: 30_000 });
        await expect(hostMatch.matchResultText).toHaveText('You won');
        await expect(clientMatch.matchResultText).toHaveText('You lose');
    });

    test.describe('client first player', () => {
        test.use({ firstPlayer: 'client' });

        test('client wins: client sees You won and host sees You lose', async ({
            hostWindow,
            clientWindow,
        }) => {
            const hostMatch = new MatchPage(hostWindow);
            const clientMatch = new MatchPage(clientWindow);

            await clientMatch.attackAdjacentEnemy();

            await expect(clientMatch.matchResultBanner).toBeVisible({ timeout: 30_000 });
            await expect(hostMatch.matchResultBanner).toBeVisible({ timeout: 30_000 });
            await expect(clientMatch.matchResultText).toHaveText('You won');
            await expect(hostMatch.matchResultText).toHaveText('You lose');
        });
    });
});
