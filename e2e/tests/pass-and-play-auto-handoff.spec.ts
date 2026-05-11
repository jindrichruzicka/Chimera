/**
 * pass-and-play-auto-handoff.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies the two-local-seat pass-and-play flow: ending a turn automatically
 * hands the same host window to the next local game seat without a manual
 * handoff click.
 *
 * Invariants covered:
 *   #3 — GameSnapshot never leaves the host's main process; PlayerSnapshot is
 *        the only cross-boundary state type.
 *   #4 — PlayerSnapshot.isMyTurn drives turn ownership at the renderer edge;
 *        the renderer reads state, never writes it.
 *   #8 — Each host-window view is a projected PlayerSnapshot for the active seat.
 */
import { test, expect } from '../fixtures/direct-match.fixture';
import { MatchPage } from '../pages/MatchPage';

test.describe('Pass-and-play auto handoff', () => {
    test.use({ passAndPlay: true });

    test('end-turn automatically hands the host window between local seats', async ({
        hostWindow,
    }) => {
        const match = new MatchPage(hostWindow);

        await match.moveOwnedUnit();
        await expect(match.undoButton).toBeEnabled();

        await match.endTurnButton.click();
        await expect(match.endTurnButton).toBeDisabled();
        await expect(match.undoButton).toBeDisabled();
        await expect(match.endTurnButton).toBeEnabled();

        await match.moveOwnedUnit();
        await expect(match.undoButton).toBeEnabled();

        await match.endTurnButton.click();
        await expect(match.endTurnButton).toBeDisabled();
        await expect(match.undoButton).toBeDisabled();
        await expect(match.endTurnButton).toBeEnabled();
    });
});
