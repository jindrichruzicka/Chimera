/**
 * stamina-reset-new-match.spec.ts
 *
 * Regression for the cross-match state leak: a unit's stamina spent in one match
 * must NOT carry into the next. Before the fix, the engine's match-boundary
 * reducers spread the whole prior snapshot forward (`engine:start_game` /
 * `engine:return_to_lobby`), so tactics' `playerStamina` ledger survived into the
 * new match and a unit started the second game with depleted stamina.
 *
 * Flow (real two-process host+client IPC + projection — the E2E-tier invariant):
 *   1. game.fixture auto-starts the first match; host moves once (stamina 3 → 2).
 *   2. Host leaves via the in-game menu → both return to the lobby.
 *   3. A new match starts from the same lobby.
 *   4. The host unit's stamina is full again (3/3), proving the ledger reset.
 *
 * Sequential turn mode (game.fixture default); host is first player, so its own
 * stamina readout is the local, owner-only HUD value. CI runs ~an order slower,
 * so every cross-process wait is generously polled.
 */
import { test, expect } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';
import { LobbyPage } from '../pages/LobbyPage';
import { InGameMenuPage } from '../pages/InGameMenuPage';
import { readyAndStart } from '../helpers/lobby-match';

const NAV_TIMEOUT_MS = 20_000;
const CANVAS_TIMEOUT_MS = 15_000;

test.describe('stamina resets when a new match starts after returning to the lobby', () => {
    test('a unit spent in the first match starts the next match with full stamina', async ({
        hostWindow,
        clientWindow,
    }) => {
        test.slow();

        // ── First match: spend one stamina ──────────────────────────────────
        const host = new GamePage(hostWindow);
        await expect(host.canvas).toBeVisible({ timeout: CANVAS_TIMEOUT_MS });
        await expect.poll(() => host.turnStatusText(), { timeout: NAV_TIMEOUT_MS }).toBe('Your turn');
        await expect.poll(() => host.staminaText(), { timeout: NAV_TIMEOUT_MS }).toBe('3/3');

        // Move the unit one tile (a central neighbour keeps it well-projected) so
        // exactly one stamina is spent.
        const start = await host.localUnitGrid();
        const neighbor = { x: start.x <= 0 ? start.x + 1 : start.x - 1, y: start.y };
        await host.moveOwnedUnitTo(neighbor);
        await expect.poll(() => host.staminaText(), { timeout: NAV_TIMEOUT_MS }).toBe('2/3');

        // ── Leave the match → both windows return to the lobby ───────────────
        const hostMenu = new InGameMenuPage(hostWindow);
        await hostMenu.openViaEscape();
        await hostMenu.confirmLeave();

        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);
        await expect(hostLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await expect(clientLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        // ── New match from the same lobby ────────────────────────────────────
        await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);

        const hostNext = new GamePage(hostWindow);
        await expect(hostNext.canvas).toBeVisible({ timeout: CANVAS_TIMEOUT_MS });
        await expect
            .poll(() => hostNext.turnStatusText(), { timeout: NAV_TIMEOUT_MS })
            .toBe('Your turn');

        // The leak: before the fix this read '2/3' (the prior match's spent ledger
        // rode forward). After the fix the ledger is dropped at the match boundary,
        // so the unit starts the new match at full stamina.
        await expect
            .poll(() => hostNext.staminaText(), { timeout: NAV_TIMEOUT_MS })
            .toBe('3/3');
    });
});
