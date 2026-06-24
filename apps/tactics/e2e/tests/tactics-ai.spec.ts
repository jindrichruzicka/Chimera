/**
 * tactics-ai.spec.ts
 *
 * Issue #730 (F54). E2E for AI players in the Tactics lobby and in a match:
 *   - "Add AI" is disabled once the lobby is full (humans + AI === max seats);
 *   - an added AI appears in the AI sub-list with its badge;
 *   - a human join that would overflow auto-removes an AI to make room (#724);
 *   - a hosted match seats a lobby-added AI, and the host-side AI drive plays the
 *     AI's whole turn so control returns to the host — in both sequential and
 *     simultaneous (commitment) turn modes.
 *
 * Asserts on observable lobby roster state and the in-match HUD only. CI runs
 * ~an order slower; every wait is polled with a generous budget.
 */
import { test, expect } from '../fixtures/lobby.fixture';
import { TacticsLobbyPage } from '../pages/TacticsLobbyPage';
import { GamePage } from '../pages/GamePage';

// TACTICS_MAX_PLAYERS — humans + AI seats combined.
const MAX_SEATS = 4;

test.describe('Tactics AI players', () => {
    test('Add-AI fills to capacity, lists each AI, and a human join auto-removes an AI', async ({
        hostWindow,
        clientWindow,
    }) => {
        test.slow();
        const hostLobby = new TacticsLobbyPage(hostWindow);
        const clientLobby = new TacticsLobbyPage(clientWindow);

        await hostLobby.hostLobby();

        // Fill the remaining seats with AI: host (1 human) + 3 AI === 4 seats.
        for (let count = 1; count <= MAX_SEATS - 1; count += 1) {
            await hostLobby.addAi();
            await hostLobby.expectAiCount(count);
        }

        // The roster lists each AI with its badge, and Add-AI is now disabled (full).
        await expect(hostWindow.getByTestId('tactics-ai-badge-1')).toBeVisible();
        await expect(hostLobby.addAiButton()).toBeDisabled();

        // A human joining would overflow (2 humans + 3 AI > 4) → the host drops one
        // AI to seat the human (#724). Both humans end up seated, AI count drops to 2.
        const code = await hostLobby.lobbyCode();
        await clientLobby.joinLobby(code);
        await hostLobby.waitForPlayerCount(2);
        await hostLobby.expectAiCount(MAX_SEATS - 2);
    });

    // A hosted match with one AI seat: the host hands the turn over, the host-side
    // AI drive plays the AI's whole turn (tactics has no wall-clock tick loop, so
    // the host pumps the agent), and control returns to the host — or the AI's
    // attack ended the match, a valid smoke outcome (the human lost). Asserts on
    // the in-match HUD only. CI runs ~an order slower; every wait is polled.
    test('an AI seat plays its turn automatically and hands control back (sequential)', async ({
        hostWindow,
    }) => {
        test.slow();
        const hostLobby = new TacticsLobbyPage(hostWindow);

        // Host + one AI is enough to start a 2-seat match.
        await hostLobby.hostLobby();
        await hostLobby.addAi();
        await hostLobby.expectAiCount(1);

        await hostLobby.toggleReady();
        await expect(hostLobby.startButton).toBeEnabled({ timeout: 20_000 });
        await hostLobby.startButton.click();

        const host = new GamePage(hostWindow);
        await expect(host.canvas).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => host.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');

        // Hand the turn to the AI. The host drives it to the end of its turn, so its
        // moves advance the tick past the lone end-turn before control returns.
        const tickBeforeAi = await host.currentTick();
        await host.endTurnButton.click();

        await expect
            .poll(() => host.currentTick(), { timeout: 45_000 })
            .toBeGreaterThan(tickBeforeAi + 1);
        await expect.poll(() => turnReturnedOrGameOver(host), { timeout: 45_000 }).toBe(true);
    });

    // Same smoke, but with "Simultaneous turns" (commitment mode) enabled: both
    // seats are active at once. The host commits (an empty commit is legal); the
    // host-side AI drive makes the AI commit too, the completing commit
    // auto-reveals, and a fresh simultaneous turn begins — proving the AI is not
    // stuck waiting to commit.
    test('an AI seat commits and the simultaneous turn resolves (commitment mode)', async ({
        hostWindow,
    }) => {
        test.slow();
        const hostLobby = new TacticsLobbyPage(hostWindow);

        await hostLobby.hostLobby();
        await hostLobby.enableCommitmentScheme();
        await hostLobby.expectCommitmentEnabled(true);
        await hostLobby.addAi();
        await hostLobby.expectAiCount(1);

        await hostLobby.toggleReady();
        await expect(hostLobby.startButton).toBeEnabled({ timeout: 20_000 });
        await hostLobby.startButton.click();

        const host = new GamePage(hostWindow);
        await expect(host.canvas).toBeVisible({ timeout: 15_000 });
        // Commitment mode: every not-yet-committed seat is active simultaneously.
        await expect.poll(() => host.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');

        const tickBeforeCommit = await host.currentTick();
        await host.endTurnButton.click();

        // The host's commit + the AI's commit + the reveal each advance the tick.
        await expect
            .poll(() => host.currentTick(), { timeout: 45_000 })
            .toBeGreaterThan(tickBeforeCommit);
        await expect.poll(() => turnReturnedOrGameOver(host), { timeout: 45_000 }).toBe(true);
    });
});

/**
 * A valid post-AI-turn smoke outcome: control is back with the host for a fresh
 * turn, or the match concluded (the result banner is up). Either proves the AI
 * advanced the game rather than stalling.
 */
async function turnReturnedOrGameOver(host: GamePage): Promise<boolean> {
    if (await host.gameResultBanner.isVisible()) {
        return true;
    }
    return (await host.turnStatusText()) === 'Your turn';
}
