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
    test('host wins: host resolves win outcome and client resolves loss outcome', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostMatch = new MatchPage(hostWindow);
        const clientMatch = new MatchPage(clientWindow);

        await hostMatch.revealAdjacentTile();
        await hostMatch.attackAdjacentEnemy();

        await expect(hostMatch.matchResultBanner).toBeVisible({ timeout: 30_000 });
        await expect(clientMatch.matchResultBanner).toBeVisible({ timeout: 30_000 });
        await expect(hostMatch.matchResultBanner).toHaveAttribute(
            'data-match-result-outcome',
            'win',
        );
        await expect(clientMatch.matchResultBanner).toHaveAttribute(
            'data-match-result-outcome',
            'loss',
        );
    });

    test.describe('client first player', () => {
        test.use({ firstPlayer: 'client' });

        test('client wins: client resolves win outcome and host resolves loss outcome', async ({
            hostWindow,
            clientWindow,
        }) => {
            const hostMatch = new MatchPage(hostWindow);
            const clientMatch = new MatchPage(clientWindow);

            await clientMatch.revealAdjacentTile();
            await clientMatch.attackAdjacentEnemy();

            await expect(clientMatch.matchResultBanner).toBeVisible({ timeout: 30_000 });
            await expect(hostMatch.matchResultBanner).toBeVisible({ timeout: 30_000 });
            await expect(clientMatch.matchResultBanner).toHaveAttribute(
                'data-match-result-outcome',
                'win',
            );
            await expect(hostMatch.matchResultBanner).toHaveAttribute(
                'data-match-result-outcome',
                'loss',
            );
        });
    });
});
