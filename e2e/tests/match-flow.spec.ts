/**
 * F33 — match-flow.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies the full match lifecycle:
 *   - Both host and client windows reach the game-over state
 *
 * The game.fixture handles the full lobby → match transition; this spec
 * only asserts the end state.
 *
 * Invariant #42: GameSnapshot.tick increments by exactly 1 per action —
 * the match must reach game-over through normal pipeline processing,
 * never by directly mutating tick.
 */
import { test, expect } from '../fixtures/game.fixture';
import { MatchPage } from '../pages/MatchPage';

test.describe('Match flow', () => {
    test('host and client reach game-over state', async ({ hostWindow, clientWindow }) => {
        const hostMatch = new MatchPage(hostWindow);
        const clientMatch = new MatchPage(clientWindow);

        await expect(hostMatch.gameOverBanner).toBeVisible({ timeout: 60_000 });
        await expect(clientMatch.gameOverBanner).toBeVisible({ timeout: 60_000 });
    });
});
