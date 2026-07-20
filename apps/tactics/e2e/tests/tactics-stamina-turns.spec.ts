/**
 * tactics-stamina-turns.spec.ts
 *
 * Issue #730 (F54). E2E for turn-gating + stamina in the default SEQUENTIAL
 * tactics turn mode:
 *   - the off-turn player's board is non-interactive (a move is rejected);
 *   - the turn-status badge reflects whose turn it is;
 *   - stamina shows `current/max`, decrements on each move, and a 4th action at
 *     0 stamina is blocked;
 *   - stamina refreshes when the player's next turn begins.
 *
 * Drives the real host+client match (game.fixture auto-starts it) and asserts on
 * observable HUD text and the projected snapshot only — never privileged
 * internals (F54 invariant). CI runs ~an order slower, so every wait is polled
 * with a generous budget; `test.slow()` triples the per-test timeout.
 */
import { test, expect } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';

test.describe('Tactics turn-gating + stamina (sequential mode)', () => {
    /**
     * Collapse the unit-movement tween before driving the board.
     *
     * The unit mesh is animated between tiles over `--ch-duration-normal`
     * (`TacticsUnitPrimitive`), which DECOUPLES rendered geometry from snapshot
     * state: this spec clicks cell centres, so a click aimed at the unit while it
     * is still sliding can miss the mesh and hit the ground plane behind it. That
     * turns a "select" into a stray ground click and desynchronises the
     * select-then-move pairing the stamina assertions depend on.
     *
     * `prefers-reduced-motion` zeroes that token, so the mesh snaps and geometry
     * always agrees with the projected snapshot. Animation is not what this spec
     * tests — turn-gating and stamina accounting are. (Occluded Playwright windows
     * also freeze CSS transition clocks, the same reason the i18n spec emulates
     * this.)
     */
    test.beforeEach(async ({ hostWindow, clientWindow }) => {
        await hostWindow.emulateMedia({ reducedMotion: 'reduce' });
        await clientWindow.emulateMedia({ reducedMotion: 'reduce' });
    });

    test('the off-turn board is non-interactive and the turn badge tracks the active seat', async ({
        hostWindow,
        clientWindow,
    }) => {
        test.slow();
        const host = new GamePage(hostWindow);
        const client = new GamePage(clientWindow);
        await expect(host.canvas).toBeVisible({ timeout: 15_000 });
        await expect(client.canvas).toBeVisible({ timeout: 15_000 });

        // Host moves first (game.fixture default firstPlayer='host').
        await expect.poll(() => host.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');
        await expect.poll(() => client.turnStatusText(), { timeout: 20_000 }).toBe('Waiting');

        // The off-turn client board ignores input — a move attempt is rejected.
        await client.expectOwnedMoveRejected();

        // Host ends its turn; control passes to the client and the badges swap.
        await host.endTurnButton.click();
        await expect.poll(() => client.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');
        await expect.poll(() => host.turnStatusText(), { timeout: 20_000 }).toBe('Waiting');

        // Now the host is off-turn and its board is inert.
        await host.expectOwnedMoveRejected();
    });

    test('stamina shows current/max, decrements per move, blocks a 4th action, and refreshes next turn', async ({
        hostWindow,
        clientWindow,
    }) => {
        test.slow();
        const host = new GamePage(hostWindow);
        const client = new GamePage(clientWindow);
        await expect(host.canvas).toBeVisible({ timeout: 15_000 });
        await expect(client.canvas).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => host.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');

        // Full at turn start.
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('3/3');

        // Bounce the unit between its start tile and a central neighbour so every
        // move is valid (the unit vacates as it enters) and stays in the
        // well-projected centre of the board (board x∈[-2,3]); each spends one
        // stamina.
        const start = await host.localUnitGrid();
        const neighbor = { x: start.x <= 0 ? start.x + 1 : start.x - 1, y: start.y };

        await host.moveOwnedUnitTo(neighbor);
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('2/3');
        await host.moveOwnedUnitTo(start);
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('1/3');
        await host.moveOwnedUnitTo(neighbor);
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('0/3');

        // A 4th action at 0 stamina is blocked — the unit does not move.
        await host.expectOwnedMoveRejected();
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('0/3');

        // End the host's turn, the client passes too, and the host's next turn
        // refreshes stamina back to full.
        await host.endTurnButton.click();
        await expect.poll(() => client.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');
        await client.endTurnButton.click();
        await expect.poll(() => host.turnStatusText(), { timeout: 20_000 }).toBe('Your turn');
        await expect.poll(() => host.staminaText(), { timeout: 20_000 }).toBe('3/3');
    });
});
