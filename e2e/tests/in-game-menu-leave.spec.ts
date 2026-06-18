/**
 * #743 — E2E coverage for the in-game menu and role-aware leave (M8).
 *
 * Proves, on the real two-process IPC + projection path (no mocked
 * simulation/transport — the E2E-tier invariant):
 *   1. Escape toggles the tactics in-game menu; an open chat drawer consumes
 *      Escape first (the drawer closes without the menu opening in its place).
 *   2. A host's Leave game returns the host AND the connected client to the
 *      lobby (#736 return-to-lobby), from which a new match starts.
 *   3. A client's Leave game returns that client to the main menu (#741) while
 *      the host's match keeps advancing.
 *
 * Base fixture: game.fixture leaves both windows in a started Tactics match
 * before every test, so each test starts in-match.
 */

import { test, expect } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';
import { LobbyPage } from '../pages/LobbyPage';
import { ChatPanelPage } from '../pages/ChatPanelPage';
import { InGameMenuPage } from '../pages/InGameMenuPage';
import { readyAndStart } from '../helpers/lobby-match';
import { getSimulationTick } from '../helpers/ipc-spy';
import { tick } from '../helpers/tick-driver';

// Return-to-lobby and client→main-menu both round-trip through two Electron
// processes; CI runs an order slower than local (the issue calls this out), so
// give the cross-process screen-arrival polls a generous budget.
const NAV_TIMEOUT_MS = 20_000;
const CANVAS_TIMEOUT_MS = 15_000;

test.describe('in-game menu and role-aware leave', () => {
    test('Escape toggles the in-game menu; an open chat drawer consumes Escape first', async ({
        hostWindow,
    }) => {
        const menu = new InGameMenuPage(hostWindow);

        // Escape opens the menu; Escape again closes it.
        await menu.openViaEscape();
        await expect(menu.cancelButton).toBeVisible();
        await expect(menu.confirmButton).toBeVisible();
        await menu.closeViaEscape();

        // Open the in-match chat drawer, then press Escape: the drawer must
        // consume the Escape (close) WITHOUT the menu opening in its place.
        const chat = new ChatPanelPage(hostWindow);
        await chat.openInMatchChat();
        await hostWindow.keyboard.press('Escape');
        await expect(chat.panel).toBeHidden();
        await expect(menu.dialog).toBeHidden();

        // With the drawer gone, the Escape stack is empty again and the next
        // Escape reaches the menu toggle.
        await menu.openViaEscape();
    });

    test('host Leave game returns host + client to the lobby and a new match starts', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostMenu = new InGameMenuPage(hostWindow);
        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);

        await hostMenu.openViaEscape();
        // Role-aware copy: the host is warned the match ends for everyone.
        await expect(hostMenu.prompt).toContainText('returns all players to the lobby');
        await hostMenu.confirmLeave();

        // Return-to-lobby (#736): both windows land back on the lobby screen,
        // roster intact.
        await expect(hostLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await expect(clientLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        // Returning to the lobby clears every ready flag (the reverse of Start's
        // all-ready gate) — both seats are not-ready again on both windows, even
        // though both were ready when the match started.
        const hostId = await hostLobby.localPlayerId();
        const clientId = await clientLobby.localPlayerId();
        if (!hostId || !clientId) throw new Error('Could not resolve lobby player ids');
        await expect
            .poll(() =>
                Promise.all([
                    hostLobby.playerReadyStatusById(hostId),
                    hostLobby.playerReadyStatusById(clientId),
                ]),
            )
            .toEqual(['false', 'false']);
        await expect
            .poll(() =>
                Promise.all([
                    clientLobby.playerReadyStatusById(hostId),
                    clientLobby.playerReadyStatusById(clientId),
                ]),
            )
            .toEqual(['false', 'false']);

        // A new match starts cleanly from the same lobby (AC: "a new match
        // starts successfully").
        await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);
        await expect(new GamePage(hostWindow).canvas).toBeVisible({ timeout: CANVAS_TIMEOUT_MS });
        await expect(new GamePage(clientWindow).canvas).toBeVisible({ timeout: CANVAS_TIMEOUT_MS });
    });

    test('client Leave game returns the client to the main menu while the host keeps playing', async ({
        hostApp,
        hostWindow,
        clientWindow,
    }) => {
        const clientMenu = new InGameMenuPage(clientWindow);
        const hostGame = new GamePage(hostWindow);

        const tickBefore = await getSimulationTick(hostApp);

        await clientMenu.openViaEscape();
        // Role-aware copy: the client is warned it disconnects to the main menu.
        await expect(clientMenu.prompt).toContainText('returns you to the main menu');
        await clientMenu.confirmLeave();

        // Client (#741): the leaving player lands on the main menu.
        await expect(clientWindow.getByTestId('main-menu')).toBeVisible({
            timeout: NAV_TIMEOUT_MS,
        });

        // The host is unaffected — still in the match, scene unchanged …
        await expect(hostGame.canvas).toBeVisible();
        await expect.poll(() => hostGame.activeSceneId()).toBe('engine:game');

        // … and the host snapshot keeps advancing as ticks are dispatched.
        await tick(hostApp, 50);
        await expect.poll(() => getSimulationTick(hostApp)).toBeGreaterThan(tickBefore);
    });
});
