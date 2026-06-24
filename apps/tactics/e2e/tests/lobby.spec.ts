/**
 * F33 — lobby.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies the full lobby lifecycle:
 *   - Host creates lobby (hostLobby())
 *   - Client joins via the host-issued lobby code (joinLobby())
 *   - Both windows show playerList with two entries (waitForPlayerCount(2))
 *   - Both windows expose data-status="connected"
 *   - Leave Lobby: host and client scenarios (issue #487)
 *
 * Invariant #6: Network messages are validated before touching the simulation —
 * the lobby join flow must complete the full WebSocket handshake.
 *
 * Invariant #40: LobbyManager.closeLobby() must complete before provider.dispose() —
 * teardown must not race with the leave action (verified by waiting for the
 * pre-lobby screen before fixture cleanup).
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

    test('both players toggle ready; ready status updates in both windows', async ({
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

        await hostLobby.toggleReady();

        // Resolve player IDs from each window's local perspective to avoid
        // relying on positional index (WARN-1 fix: ordering is not guaranteed).
        const hostPlayerId = await hostLobby.localPlayerId();
        const clientPlayerId = await clientLobby.localPlayerId();
        if (!hostPlayerId) throw new Error('Could not determine host player ID');
        if (!clientPlayerId) throw new Error('Could not determine client player ID');

        await expect.poll(() => hostLobby.playerReadyStatusById(hostPlayerId)).toBe('true');
        await expect.poll(() => clientLobby.playerReadyStatusById(hostPlayerId)).toBe('true');
        await expect.poll(() => hostLobby.playerReadyStatusById(clientPlayerId)).toBe('false');
        await expect.poll(() => clientLobby.playerReadyStatusById(clientPlayerId)).toBe('false');

        await clientLobby.toggleReady();

        await expect
            .poll(() =>
                Promise.all([
                    hostLobby.playerReadyStatusById(hostPlayerId),
                    hostLobby.playerReadyStatusById(clientPlayerId),
                ]),
            )
            .toEqual(['true', 'true']);
        await expect
            .poll(() =>
                Promise.all([
                    clientLobby.playerReadyStatusById(hostPlayerId),
                    clientLobby.playerReadyStatusById(clientPlayerId),
                ]),
            )
            .toEqual(['true', 'true']);
    });

    test('host leaves; both windows return to pre-lobby screen', async ({
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

        await hostLobby.leaveLobby();

        // Host window must return to pre-lobby immediately (leaveLobby() waits for it).
        // Client window must also return to pre-lobby once the disconnect reason
        // host_closed propagates through onConnectionStatus → lobbyStore cleared.
        await clientLobby.waitForPreLobbyScreen();
    });

    test('client leaves; client returns to pre-lobby; host stays with 1 player', async ({
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

        await clientLobby.leaveLobby();

        // Client window must return to pre-lobby (leaveLobby() waits for it).
        // Host window must still show the lobby with only 1 player remaining.
        await hostLobby.waitForPlayerCount(1);
    });
});

test.describe('Start Game button enable/disable', () => {
    test('start-game is disabled for client regardless of all-ready state', async ({
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

        await hostLobby.toggleReady();
        await clientLobby.toggleReady();

        const hostPlayerId = await hostLobby.localPlayerId();
        const clientPlayerId = await clientLobby.localPlayerId();
        if (!hostPlayerId || !clientPlayerId) throw new Error('Could not determine player IDs');

        // Wait for both to be ready
        await expect
            .poll(() =>
                Promise.all([
                    hostLobby.playerReadyStatusById(hostPlayerId),
                    hostLobby.playerReadyStatusById(clientPlayerId),
                ]),
            )
            .toEqual(['true', 'true']);

        // Client window must keep start-game disabled
        await expect(clientLobby.startButton).toBeDisabled();
    });

    test('start-game enables for host when all ready; disables when any player unreadies', async ({
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

        // Before any ready: start-game disabled for host
        await expect(hostLobby.startButton).toBeDisabled();

        await hostLobby.toggleReady();
        await clientLobby.toggleReady();

        const hostPlayerId = await hostLobby.localPlayerId();
        const clientPlayerId = await clientLobby.localPlayerId();
        if (!hostPlayerId || !clientPlayerId) throw new Error('Could not determine player IDs');

        // Wait until both players are ready in host's view
        await expect
            .poll(() =>
                Promise.all([
                    hostLobby.playerReadyStatusById(hostPlayerId),
                    hostLobby.playerReadyStatusById(clientPlayerId),
                ]),
            )
            .toEqual(['true', 'true']);

        // start-game must be enabled for the host
        await expect(hostLobby.startButton).toBeEnabled();

        // Host toggles back to unready
        await hostLobby.toggleReady();
        await expect.poll(() => hostLobby.playerReadyStatusById(hostPlayerId)).toBe('false');

        // start-game must be disabled again
        await expect(hostLobby.startButton).toBeDisabled();
    });
});
