/**
 * tactics-replay-initial-color.spec.ts
 *
 * Regression coverage for the "player colour flashes default → chosen at replay
 * start" bug (fix/replay-initial-setup-color).
 *
 * Player colour (and every other seat attribute) is host-authored lobby SETUP —
 * match-initialization data carried on the engine:start_game payload, not a
 * gameplay action. A deterministic replay reconstructs its initial frame from
 * `seed + gameConfig` (frozen at lobby-start, before setup exists), so the first
 * reconstructed frame used to render with the DEFAULT colour until the recorded
 * engine:start_game action replayed — a one-frame flash. The reconstruction now
 * lifts setup from the replay's first engine:start_game action, so the very first
 * frame already carries the chosen colour.
 *
 * This proves it end-to-end through the real renderer + main IPC path:
 *   - the host picks its own colour in the lobby (green) and starts;
 *   - the host drives the match to game-over (the idle client is its opponent);
 *   - opening the finished match in the deterministic replay player, the FIRST
 *     reconstructed frame (`replay.snapshotAt(0)`) already carries the host's
 *     chosen colour — no default-colour first frame.
 *
 * Invariant #3: reads only the projected PlayerSnapshot (via replay.snapshotAt),
 * never a GameSnapshot. Invariant #42: the match starts through Start and ends
 * through real move/attack actions, never by mutating tick.
 */
import { test, expect } from '../fixtures/lobby.fixture';
import { TacticsLobbyPage } from '../pages/TacticsLobbyPage';
import { GamePage } from '../pages/GamePage';
import { ReplayPlayerPage } from '../pages/ReplayPlayerPage';

const HOST_COLOR = 'green';

// Renderer bridge slice (window.__chimera) reached through page.evaluate. The
// e2e root tsconfig is DOM-less, so only the fields this spec reads are typed.
interface ReplaySetupSnapshot {
    readonly setup?: {
        readonly playerAttributes: Readonly<Record<string, Readonly<Record<string, string>>>>;
    };
}
interface ChimeraReplayGlobal {
    readonly __chimera: {
        readonly replay: {
            snapshotAt(tick: number): Promise<ReplaySetupSnapshot>;
        };
    };
}

test.describe('Tactics replay initial colour', () => {
    test("the first replay frame carries the host's chosen colour (no default-colour flash)", async ({
        hostWindow,
        clientWindow,
    }) => {
        // Lobby + Start, then a full match to game-over and replay reconstruction;
        // CI (Xvfb + software GL) makes each canvas screenshot costly, so triple
        // the default budget like the sibling colour/replay specs.
        test.slow();

        const hostLobby = new TacticsLobbyPage(hostWindow);
        const clientLobby = new TacticsLobbyPage(clientWindow);

        // ── Host + client reach a shared 2-player tactics lobby ─────────────────
        await hostLobby.hostLobby();
        const lobbyCode = await hostLobby.lobbyCode();
        await clientLobby.joinLobby(lobbyCode);

        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        const hostPlayerId = await hostLobby.localPlayerId();
        if (hostPlayerId === null) throw new Error('Could not resolve host player id');

        // ── Host authors its own colour, both ready → Start ─────────────────────
        await hostLobby.setPlayerColor(hostPlayerId, HOST_COLOR);
        await hostLobby.expectPlayerColor(hostPlayerId, HOST_COLOR);

        await hostLobby.toggleReady();
        await clientLobby.toggleReady();
        await expect(hostLobby.startButton).toBeEnabled();
        await hostLobby.startButton.click();

        const hostGame = new GamePage(hostWindow);
        await expect(hostGame.canvas).toBeVisible({ timeout: 15_000 });

        // Sanity: the LIVE match already carries the host's chosen colour (the
        // bug was never in live play — only in replay reconstruction).
        const liveSetup = await hostGame.waitForGameSetup();
        expect(liveSetup.playerAttributes[hostPlayerId]?.['color']).toBe(HOST_COLOR);

        // ── Host drives the match to game-over (idle client is the opponent) ────
        await hostGame.assertOwnedSelectionFeedbackChangesCanvas();
        await hostGame.moveSelectedPrimitiveNearOpponent();
        await hostGame.attackAdjacentEnemy();
        await expect(hostGame.gameResultBanner).toBeVisible({ timeout: 60_000 });

        // ── Post-game summary → open the deterministic (reconstructed) replay ───
        await expect.poll(() => hostGame.activeSceneId(), { timeout: 15_000 }).toBe('engine:game');
        await hostWindow.keyboard.press('Enter');
        await expect.poll(() => hostGame.activeScreenKey(), { timeout: 15_000 }).toBe('summary');
        await expect(hostGame.postGameSummary).toBeVisible();

        await hostGame.replayButton.click();
        const player = new ReplayPlayerPage(hostWindow);
        await expect(player.playButton).toBeVisible({ timeout: 30_000 });

        // ── The regression guard ────────────────────────────────────────────────
        // The very first reconstructed replay frame (renderer tick 0 → the base
        // snapshot) already carries the host's chosen colour. Before the fix,
        // snapshotAt(0).setup was undefined (default colour) until the recorded
        // engine:start_game action replayed a frame later.
        const firstFrameColor = await hostWindow.evaluate(
            (hostId) =>
                (globalThis as unknown as ChimeraReplayGlobal).__chimera.replay
                    .snapshotAt(0)
                    .then((snap) => snap.setup?.playerAttributes?.[hostId]?.['color'] ?? null),
            hostPlayerId,
        );
        expect(firstFrameColor).toBe(HOST_COLOR);
    });
});
