/**
 * F33 — lobby.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies the full lobby lifecycle:
 *   - Host creates lobby (hostLobby())
 *   - Client joins via the host-issued lobby code (joinLobby())
 *   - Both windows show playerList with two entries (waitForPlayerCount(2))
 *   - Both windows expose data-status="connected"
 *
 * Invariant #6: Network messages are validated before touching the simulation —
 * the lobby join flow must complete the full WebSocket handshake.
 */
import { test, expect } from '../fixtures/lobby.fixture';
import { LobbyPage } from '../pages/LobbyPage';

test.describe('Lobby lifecycle', () => {
    test('host creates lobby; client joins; player list syncs in both windows', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);

        await hostLobby.hostLobby();
        const lobbyCode = await hostLobby.lobbyCode();
        await clientLobby.joinLobby(lobbyCode);
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);
        await expect(hostLobby.connectionStatus).toHaveAttribute('data-status', 'connected');
        await expect(clientLobby.connectionStatus).toHaveAttribute('data-status', 'connected');
    });
});
