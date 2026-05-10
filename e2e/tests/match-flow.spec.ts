/**
 * F33 — match-flow.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies the full match lifecycle:
 *   - Host resolves the match through the normal attack action
 *   - Both host and client windows reach the game-over state
 *
 * The game.fixture handles the full lobby → match transition; this spec
 * drives the in-match action that resolves the end state.
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

        await hostMatch.attackAdjacentEnemy();

        await expect(hostMatch.matchResultBanner).toBeVisible({ timeout: 60_000 });
        await expect(clientMatch.matchResultBanner).toBeVisible({ timeout: 60_000 });
    });
});
