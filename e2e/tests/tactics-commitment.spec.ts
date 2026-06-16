/**
 * tactics-commitment.spec.ts
 *
 * Issue #730 (F54) — the HEADLINE spec. Drives the commitment-scheme battle mode
 * end-to-end across a real host+client match:
 *   - the host enables the Battle Setup toggle; it syncs to the client (read-only)
 *     and is carried into the match as `setup.matchSettings.turnMode='commitment'`;
 *   - both seats are active SIMULTANEOUSLY (parallel local play);
 *   - a buffered move decrements stamina OPTIMISTICALLY and is NOT dispatched
 *     (the host's projected snapshot is unchanged → the client never sees it);
 *   - Undo before commit refunds the stamina;
 *   - `End Turn` is disabled until BOTH seats commit; committing shows a waiting
 *     state;
 *   - after both commit, End Turn triggers the reveal, which applies both turns
 *     authoritatively and starts a fresh turn (stamina refreshes).
 *
 * Reveal ATTACK-PRIORITY ordering and a committed attack ENDING the game are
 * verified deterministically at the host-integration level
 * (electron/main/__tests__/reveal-sync.integration.test.ts, AC1/AC4); forcing
 * fog-gated adjacency through the canvas would only add flake here.
 *
 * Asserts on observable HUD/board/snapshot state only. `test.slow()` for the
 * canvas-heavy, multi-window flow; every wait is polled (CI ~an order slower).
 */
import { test, expect } from '../fixtures/lobby.fixture';
import { TacticsLobbyPage } from '../pages/TacticsLobbyPage';
import { GamePage } from '../pages/GamePage';
import type { TacticsGridPoint } from '../pages/GamePage';

/** A central neighbour tile (toward board centre, x∈[-2,3]) for a reliable move. */
function centralNeighbor(grid: TacticsGridPoint): TacticsGridPoint {
    return { x: grid.x <= 0 ? grid.x + 1 : grid.x - 1, y: grid.y };
}

test.describe('Tactics commitment battle mode (headline)', () => {
    test('host-authored toggle → parallel secret play → commit gating → reveal', async ({
        hostWindow,
        clientWindow,
    }) => {
        test.slow();
        const hostLobby = new TacticsLobbyPage(hostWindow);
        const clientLobby = new TacticsLobbyPage(clientWindow);

        // ── Host + client reach a 2-player lobby ──────────────────────────────
        await hostLobby.hostLobby();
        const code = await hostLobby.lobbyCode();
        await clientLobby.joinLobby(code);
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        const hostPlayerId = await hostLobby.localPlayerId();
        const clientPlayerId = await clientLobby.localPlayerId();
        if (hostPlayerId === null || clientPlayerId === null) {
            throw new Error('Could not resolve both player ids');
        }

        // ── Host enables the commitment scheme; it syncs read-only to the client ─
        await hostLobby.enableCommitmentScheme();
        await hostLobby.expectCommitmentEnabled(true);
        await clientLobby.expectCommitmentEnabled(true);
        await expect(clientLobby.commitmentToggle()).toBeDisabled();

        // ── All ready → Start ─────────────────────────────────────────────────
        await hostLobby.toggleReady();
        await clientLobby.toggleReady();
        await expect
            .poll(() =>
                Promise.all([
                    hostLobby.playerReadyStatusById(hostPlayerId),
                    hostLobby.playerReadyStatusById(clientPlayerId),
                ]),
            )
            .toEqual(['true', 'true']);
        await expect(hostLobby.startButton).toBeEnabled();
        await hostLobby.startButton.click();

        const host = new GamePage(hostWindow);
        const client = new GamePage(clientWindow);
        await expect(host.canvas).toBeVisible({ timeout: 15_000 });
        await expect(client.canvas).toBeVisible({ timeout: 15_000 });

        // The agreed mode is carried into the match on both peers.
        const hostSetup = await host.waitForGameSetup();
        const clientSetup = await client.waitForGameSetup();
        expect(hostSetup.matchSettings['turnMode']).toBe('commitment');
        expect(clientSetup.matchSettings['turnMode']).toBe('commitment');

        // ── Parallel play: BOTH seats are active at once; End Turn IS the commit ─
        await expect.poll(() => host.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');
        await expect.poll(() => client.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');

        // Before committing, End Turn is enabled (clicking it commits) and there is
        // no waiting message yet — no separate Commit button.
        await expect(host.endTurnButton).toBeEnabled();
        await expect(client.endTurnButton).toBeEnabled();
        await expect(host.commitStatus).toHaveCount(0);

        // ── Optimistic buffered move + undo refund (host) ─────────────────────
        const hostStart = await host.localUnitGrid();
        const hostTarget = centralNeighbor(hostStart);
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('3/3');

        await host.selectOwnedPrimitive();
        await host.clickTacticsGridPoint(hostTarget);
        // Buffered locally: stamina drops optimistically but the move is NOT
        // dispatched, so the host's projected unit stays at its origin (secrecy).
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('2/3');
        await expect.poll(() => host.localUnitGrid(), { timeout: 20_000 }).toEqual(hostStart);

        // Undo before commit pops the buffer and refunds the stamina.
        await host.undoButton.click();
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('3/3');

        // ── Re-buffer and COMMIT via End Turn (host) ──────────────────────────
        await host.selectOwnedPrimitive();
        await host.clickTacticsGridPoint(hostTarget);
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('2/3');
        await host.endTurnButton.click(); // End Turn = commit

        // Host has committed: End Turn disables and the pulsing waiting message shows.
        await expect(host.commitStatus).toBeVisible({ timeout: 20_000 });
        await expect(host.commitStatus).toHaveAttribute('data-state', 'waiting');
        await expect(host.endTurnButton).toBeDisabled();

        // ── Client commits via End Turn → reveal happens AUTOMATICALLY ─────────
        const clientStart = await client.localUnitGrid();
        await client.selectOwnedPrimitive();
        await client.clickTacticsGridPoint(centralNeighbor(clientStart));
        await expect.poll(() => client.staminaText(), { timeout: 20_000 }).toBe('2/3');
        await client.endTurnButton.click(); // completing the set; no second confirmation

        // With NO further click, the host auto-advances + reveals: the host's
        // buffered move lands authoritatively, the reveal overlay plays back, the
        // waiting message clears, and the fresh turn refreshes stamina.
        await expect(host.revealOverlay).toBeVisible({ timeout: 20_000 });
        await expect.poll(() => host.localUnitGrid(), { timeout: 20_000 }).toEqual(hostTarget);
        await expect(host.commitStatus).toHaveCount(0);
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('3/3');
        await expect.poll(() => host.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');
    });
});
