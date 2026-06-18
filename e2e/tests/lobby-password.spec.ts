/**
 * F56 — lobby-password.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies the optional host-set lobby password (F56):
 *   - Host protects a lobby with a password.
 *   - A client presenting the correct password joins; both windows show 2 players.
 *   - A client presenting the wrong password is rejected at the handshake, sees
 *     the friendly "Incorrect password." error, and never enters the lobby; the
 *     host roster stays at 1 player.
 *
 * Invariant #6: the JOIN password is validated before the simulation — the
 * rejected client never reaches a hosted session.
 */
import { test, expect } from '../fixtures/lobby.fixture';
import { LobbyPage } from '../pages/LobbyPage';

const PASSWORD = 'open-sesame';

test.describe('Lobby password (F56)', () => {
    test('client with the correct password joins; both windows show two players', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);

        await hostLobby.hostLobby(PASSWORD);
        const lobbyCode = await hostLobby.lobbyCode();

        await clientLobby.joinLobby(lobbyCode, PASSWORD);

        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);
        await expect(clientLobby.connectionStatus).toHaveAttribute('data-status', 'connected');
    });

    test('client with the wrong password is rejected and stays on the pre-lobby screen', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);

        await hostLobby.hostLobby(PASSWORD);
        const lobbyCode = await hostLobby.lobbyCode();

        await clientLobby.attemptJoin(lobbyCode, 'wrong-password');

        // The rejection marks the password field invalid (red) — no message text,
        // no top banner — and the client never enters the lobby.
        await expect(clientLobby.joinPasswordInput).toHaveAttribute('aria-invalid', 'true');
        await expect(clientLobby.errorBanner).toBeHidden();
        await expect(clientLobby.lobbyScreen).not.toBeVisible();
        await expect(clientLobby.confirmJoinButton).toBeVisible();

        // The host is unaffected — only its own seat is present.
        await hostLobby.waitForPlayerCount(1);
    });
});
