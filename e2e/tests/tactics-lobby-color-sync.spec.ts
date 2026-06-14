/**
 * tactics-lobby-color-sync.spec.ts
 *
 * Issue #711 (part of #702 — Customizable Lobby; Architecture §13.8 / §4.37).
 *
 * Proves the customizable Tactics lobby syncs end-to-end (F53, owner-authored
 * player colour):
 *   - the host picks the shared board colour (host-authored) and its OWN colour;
 *   - the client picks its OWN colour (owner-authored);
 *   - neither peer can edit the other's colour row, nor a client the board;
 *   - both windows converge on every value via the broadcast LobbyState;
 *   - all ready → Start;
 *   - the board background and per-player unit colours match across host and
 *     client after the match starts.
 *
 * Parity is asserted two ways: authoritatively via the agreed `snapshot.setup`
 * (identical on both peers, not obfuscated) and at the pixel level via the
 * reused tactics canvas pixel helpers. Per-player unit pixels are fog-limited at
 * tick 0 — each window sees only its own unit — so each window's own colour is
 * checked locally while cross-peer per-player parity rides on the setup
 * deep-equality.
 *
 * Invariant #3: reads only the projected PlayerSnapshot / lobby state, never
 * GameSnapshot. Invariant #42: the match starts through the Start button, never
 * by mutating tick. CI tolerance: no fixed sleeps — every wait is polled.
 */
import { test, expect } from '../fixtures/lobby.fixture';
import { TacticsLobbyPage } from '../pages/TacticsLobbyPage';
import { GamePage } from '../pages/GamePage';

const BOARD_COLOR = 'navy';
const HOST_COLOR = 'green';
const CLIENT_COLOR = 'amber';

// TACTICS_PLAYER_COLOR_HEX values rendered onto the lobby swatches, as computed
// CSS rgb() strings.
const HOST_SWATCH_RGB = 'rgb(22, 163, 74)'; // #16a34a — green
const CLIENT_SWATCH_RGB = 'rgb(245, 158, 11)'; // #f59e0b — amber

// Board colours render near-identically on both peers (same synced setup, same
// orthographic camera, same white scene lighting). Units differ (green vs amber)
// but occupy <1% of pixels, so the mean opaque colour stays within this
// per-channel tolerance.
const BOARD_PARITY_TOLERANCE = 24;

test.describe('Tactics lobby colour sync', () => {
    test('each player edits its own colour, peers see others read-only and synced, and colours match after Start', async ({
        hostWindow,
        clientWindow,
    }) => {
        // Several canvas screenshots after Start; CI (Xvfb + software GL) makes
        // each costly, so triple the default budget like tactics-3d-render.
        test.slow();

        const hostLobby = new TacticsLobbyPage(hostWindow);
        const clientLobby = new TacticsLobbyPage(clientWindow);

        // ── Host + client reach a shared 2-player tactics lobby ────────────────
        await hostLobby.hostLobby();
        const lobbyCode = await hostLobby.lobbyCode();
        await clientLobby.joinLobby(lobbyCode);

        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        const hostPlayerId = await hostLobby.localPlayerId();
        const clientPlayerId = await clientLobby.localPlayerId();
        if (hostPlayerId === null) throw new Error('Could not resolve host player id');
        if (clientPlayerId === null) throw new Error('Could not resolve client player id');

        // ── Each player authors its own colour; host also sets the board ──────
        await hostLobby.setBoardColor(BOARD_COLOR);
        await hostLobby.setPlayerColor(hostPlayerId, HOST_COLOR);
        await clientLobby.setPlayerColor(clientPlayerId, CLIENT_COLOR);

        // Authority gating: host edits board + its own row; the client's row is
        // read-only to the host.
        await expect(hostLobby.boardColorSelect()).toBeEnabled();
        await expect(hostLobby.playerColorSelect(hostPlayerId)).toBeEnabled();
        await expect(hostLobby.playerColorSelect(clientPlayerId)).toBeDisabled();

        // The client owns only its own row; the board (host-authored) and the
        // host's row are read-only to the client.
        await expect(clientLobby.boardColorSelect()).toBeDisabled();
        await expect(clientLobby.playerColorSelect(clientPlayerId)).toBeEnabled();
        await expect(clientLobby.playerColorSelect(hostPlayerId)).toBeDisabled();

        // ── Both windows converge on every value via the broadcast LobbyState ──
        await hostLobby.expectBoardColor(BOARD_COLOR);
        await hostLobby.expectPlayerColor(hostPlayerId, HOST_COLOR);
        await hostLobby.expectPlayerColor(clientPlayerId, CLIENT_COLOR);

        await clientLobby.expectBoardColor(BOARD_COLOR);
        await clientLobby.expectPlayerColor(hostPlayerId, HOST_COLOR);
        await clientLobby.expectPlayerColor(clientPlayerId, CLIENT_COLOR);

        // Swatches on the client reflect both synced colours (its own + the host's).
        await expect
            .poll(() => clientLobby.swatchBackgroundColor(hostPlayerId))
            .toBe(HOST_SWATCH_RGB);
        await expect
            .poll(() => clientLobby.swatchBackgroundColor(clientPlayerId))
            .toBe(CLIENT_SWATCH_RGB);

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
        await expect
            .poll(() =>
                Promise.all([
                    clientLobby.playerReadyStatusById(hostPlayerId),
                    clientLobby.playerReadyStatusById(clientPlayerId),
                ]),
            )
            .toEqual(['true', 'true']);

        await expect(hostLobby.startButton).toBeEnabled();
        await hostLobby.startButton.click();

        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);
        await expect(hostGame.canvas).toBeVisible({ timeout: 15_000 });
        await expect(clientGame.canvas).toBeVisible({ timeout: 15_000 });

        // ── Colour parity after Start ─────────────────────────────────────────
        // Authoritative: the agreed setup is identical on both peers and matches
        // each player's lobby picks (host board + each player's own colour).
        const hostSetup = await hostGame.waitForGameSetup();
        const clientSetup = await clientGame.waitForGameSetup();

        expect(clientSetup).toEqual(hostSetup);
        expect(hostSetup.matchSettings['boardColor']).toBe(BOARD_COLOR);
        expect(hostSetup.playerAttributes[hostPlayerId]?.['color']).toBe(HOST_COLOR);
        expect(hostSetup.playerAttributes[clientPlayerId]?.['color']).toBe(CLIENT_COLOR);

        // Pixel: each window renders its own unit in its configured colour (the
        // opponent is fog-hidden at tick 0).
        await hostGame.assertTacticsCanvasHasGreenPrimitive();
        await clientGame.assertTacticsCanvasHasAmberPrimitive();

        // Pixel: the board background renders the same on both peers.
        const hostBoard = await hostGame.readTacticsCanvasBackgroundColor();
        const clientBoard = await clientGame.readTacticsCanvasBackgroundColor();
        expect(Math.abs(hostBoard.r - clientBoard.r)).toBeLessThanOrEqual(BOARD_PARITY_TOLERANCE);
        expect(Math.abs(hostBoard.g - clientBoard.g)).toBeLessThanOrEqual(BOARD_PARITY_TOLERANCE);
        expect(Math.abs(hostBoard.b - clientBoard.b)).toBeLessThanOrEqual(BOARD_PARITY_TOLERANCE);
        // Navy is a blue-tinted dark board; the blue channel is not below red.
        // This relies on TacticsDemoBoard's white lighting (ambientLight +
        // white directionalLight) preserving the navy material's b>r margin —
        // revisit this sanity check if that scene lighting changes. The exact
        // board colour is asserted authoritatively above via snapshot.setup.
        expect(hostBoard.b).toBeGreaterThanOrEqual(hostBoard.r);
    });
});
