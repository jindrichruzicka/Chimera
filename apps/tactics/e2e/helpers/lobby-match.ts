import { expect, type Page } from '@playwright/test';
import { LobbyPage } from '../pages/LobbyPage';
import { GamePage } from '../pages/GamePage';

/**
 * e2e/helpers/lobby-match.ts
 *
 * Drive a connected host+client lobby to a started match and wait for both
 * match canvases. Shared by `game.fixture` and the in-game-menu/leave spec.
 *
 * Robust to the players' current ready state: each window flips its OWN seat's
 * ready toggle only when that seat is not already ready. This works from a fresh
 * lobby and from a restart after a host return-to-lobby (which clears ready)
 * without an unconditional toggle accidentally flipping an already-ready seat
 * back to unready and stalling the start gate.
 */
export async function readyAndStart(
    hostLobby: LobbyPage,
    clientLobby: LobbyPage,
    hostWindow: Page,
    clientWindow: Page,
): Promise<void> {
    const hostPlayerId = await hostLobby.localPlayerId();
    const clientPlayerId = await clientLobby.localPlayerId();
    if (!hostPlayerId) throw new Error('Could not determine host player ID');
    if (!clientPlayerId) throw new Error('Could not determine client player ID');

    // Each player owns its own ready toggle; flip only when not already ready.
    if ((await hostLobby.playerReadyStatusById(hostPlayerId)) !== 'true') {
        await hostLobby.toggleReady();
    }
    if ((await clientLobby.playerReadyStatusById(clientPlayerId)) !== 'true') {
        await clientLobby.toggleReady();
    }

    // Gate the host Start on the host's view of both seats being ready.
    await expect
        .poll(() =>
            Promise.all([
                hostLobby.playerReadyStatusById(hostPlayerId),
                hostLobby.playerReadyStatusById(clientPlayerId),
            ]),
        )
        .toEqual(['true', 'true']);

    await hostLobby.startButton.click();

    // Under the custom Electron protocol used in E2E, route transitions can
    // render the Match screen before the URL reflects `/game`. Gate on visible
    // match UI instead of URL assertions.
    const hostGame = new GamePage(hostWindow);
    const clientGame = new GamePage(clientWindow);
    await hostGame.canvas.waitFor({ state: 'visible' });
    await clientGame.canvas.waitFor({ state: 'visible' });
    // The canvas mounts BEFORE the match is revealed: the route-entry asset gate
    // holds the app-level fade opaque until the critical preload settles (§4.10),
    // and the loading beat around it holds the HUD back for as long. Every spec
    // that starts a match this way would otherwise race that reveal, so the wait
    // lives here rather than in each spec. Both windows run their own gate, so
    // both are waited on. The gate itself is never disabled under e2e —
    // determinism comes from this wait.
    await waitForGameRevealed(hostWindow);
    await waitForGameRevealed(clientWindow);
}

/**
 * Wait until a `/game` route has actually revealed its match.
 *
 * A transparent scrim is no longer sufficient on its own. The loading beat
 * holds an OPAQUE cover above that scrim, so a window can read
 * `opacity: 0` while the player is still looking at a loading screen — a spec
 * that waited on the scrim alone would pass and then assert against a covered
 * screen. The three conditions together are what "revealed" means: the curtain
 * is down, no cover is above it, and the match chrome the beat withholds is
 * mounted.
 *
 * Tactics declares no route cover, so the middle condition is free here today —
 * it exists so the wait keeps its meaning for a game that declares one, which
 * is exactly the case that would otherwise regress unseen.
 *
 * The replay route has a second wait of its own — `ReplayPlayerPage.waitForRevealed`,
 * keyed on the shell's published beat phase.
 */
export async function waitForGameRevealed(window: Page): Promise<void> {
    await expect(window.getByTestId('screen-fade-overlay')).toHaveCSS('opacity', '0');
    await expect(window.getByTestId('route-entry-loading-cover')).toHaveCount(0);
    await expect(window.getByTestId('game-hud-slot')).toBeVisible();
}

/**
 * End the host's live session so the main menu and the replay library are
 * reachable without a snapshot steering the window.
 *
 * Two exits, because the two navigation gates in `GameStoreBootstrap` read
 * different phases. `returnToLobby()` ends the MATCH, dropping the non-'lobby'
 * snapshot the match-entry allow-set admits on /main-menu and on a game's
 * declared shell pages (§4.37.17). Leaving the lobby then ends the SESSION,
 * dropping the phase:'lobby' snapshot the reverse gate admits on /game and
 * /replays/player — which would otherwise bounce a library-opened replay
 * straight back to the lobby.
 *
 * The match exit is driven through the same `lobby.returnToLobby()` the in-game
 * menu's Leave calls for a host, rather than through that dialog: this is setup
 * for the screen under test, and callers reach it from three different screens
 * (a live match, a post-game summary, a replay player) whose Escape handling
 * differs. The lobby exit then goes through the lobby UI, which is where a
 * player leaves from in any case.
 */
export async function endHostSession(hostWindow: Page): Promise<void> {
    await hostWindow.evaluate(async () => {
        const bridge = globalThis as unknown as {
            readonly __chimera: { readonly lobby: { returnToLobby(): Promise<void> } };
        };
        await bridge.__chimera.lobby.returnToLobby();
    });

    // The host's own return-to-lobby broadcast is what carries this window off
    // the match route, so waiting on the lobby screen is what makes the leave
    // below — and the caller's next navigation — deterministic.
    const hostLobby = new LobbyPage(hostWindow);
    await expect(hostLobby.lobbyScreen).toBeVisible({ timeout: 30_000 });
    await hostLobby.leaveLobby();
}
