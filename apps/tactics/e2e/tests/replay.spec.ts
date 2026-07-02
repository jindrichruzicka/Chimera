/**
 * F44 / T9 — replay.spec.ts (#663)
 *
 * End-to-end coverage of the Tactics replay lifecycle in the packaged app,
 * exercised through the real renderer + main IPC path (not mocks):
 *   1. the post-game summary surfaces the Replay button (saving moved to the player);
 *   2. the replay player's save icon confirms success and persists a deterministic replay;
 *   3. the main-menu Replays button is disabled with no replays;
 *   4. it enables after a match and opens the replay browser;
 *   5. replaying a finished match plays back to its final tick.
 *
 * Invariants asserted:
 *   #71 — the saved deterministic replay file carries `seed` + `actions` and no
 *         projected snapshots (verified by reading the file off disk).
 *   #3  — the replay player only ever receives a projected `PlayerSnapshot`
 *         (identified by `viewerId`), never a raw `GameSnapshot`.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';
import { LobbyPage } from '../pages/LobbyPage';
import { MainMenuPage } from '../pages/MainMenuPage';
import { ReplayPlayerPage } from '../pages/ReplayPlayerPage';
// F49 / #715 — §13.4 renderer-heap budget during replay playback, from the single
// source of truth. Imported by relative path (not the @chimera-engine/* alias, which the
// Playwright spec runner does not resolve) so the gate can never drift;
// shared/perf-budget.test.ts locks the canonical value. Replay reuses the live
// ActionPipeline (Inv #42/#70), so its renderer-side heap must stay within the
// same budget as a live match. Strict locally / under CHIMERA_PERF_STRICT=1,
// informational on CI.
import { RENDERER_HEAP_BUDGET_MB } from '@chimera-engine/simulation/foundation/perf-budget.js';

const TACTICS_GAME_ID = 'tactics';

const PERF_STRICT = process.env['CHIMERA_PERF_STRICT'] === '1' || process.env['CI'] === undefined;

/** Read the renderer heap in MB exactly as perfStore.readHeapMb() does. */
async function readReplayHeapMb(window: Page): Promise<number | null> {
    return window.evaluate(() => {
        const mem = (performance as unknown as Record<string, unknown>)['memory'] as
            | { usedJSHeapSize: number }
            | undefined;
        if (mem === undefined || typeof mem.usedJSHeapSize !== 'number') {
            return null;
        }
        return mem.usedJSHeapSize / (1024 * 1024);
    });
}

// ── Renderer bridge shapes (window.__chimera) ────────────────────────────────
// The preload exposes these on `globalThis.__chimera`. The e2e root tsconfig is
// DOM-less, so the slices a test reaches through `page.evaluate` are typed here.

interface ReplayListEntry {
    readonly path: string;
}

interface GameResultShape {
    readonly winnerIds: readonly string[];
}

interface ReplayPlayerSnapshot {
    readonly viewerId?: string;
    readonly tick?: number;
    readonly gameResult: GameResultShape | null;
}

interface GameLiveSnapshot {
    readonly viewerId: string;
    readonly tick: number;
    readonly gameResult: GameResultShape | null;
}

interface ChimeraReplayGlobal {
    readonly __chimera: {
        readonly replay: {
            list(gameId: string): Promise<readonly ReplayListEntry[]>;
            snapshotAt(tick: number): Promise<ReplayPlayerSnapshot>;
        };
        readonly game: {
            sendAction(action: unknown): void;
            getCurrentSnapshot(): Promise<GameLiveSnapshot | null>;
        };
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Drive the host to game-over through the canonical move + attack flow. */
async function playToGameOver(hostGame: GamePage): Promise<void> {
    await hostGame.assertOwnedSelectionFeedbackChangesCanvas();
    await hostGame.moveSelectedPrimitiveNearOpponent();
    await hostGame.attackAdjacentEnemy();
    await expect(hostGame.gameResultBanner).toBeVisible({ timeout: 60_000 });
}

/**
 * Reach the post-game summary the way a player does: with the result banner
 * showing, press Enter. The Tactics `game:end-turn` binding (Enter) becomes
 * "continue" once the match is resolved and switches the renderer to the
 * post-game summary screen — a renderer-local screen switch (no engine action,
 * so the terminal-match gate is not involved). This mounts the summary and the
 * replay buttons gated on `gameResult !== null`.
 */
async function goToPostGameSummary(hostWindow: Page, hostGame: GamePage): Promise<void> {
    await expect.poll(() => hostGame.activeSceneId(), { timeout: 15_000 }).toBe('engine:game');

    await hostWindow.keyboard.press('Enter');

    await expect.poll(() => hostGame.activeScreenKey(), { timeout: 15_000 }).toBe('summary');
    await expect(hostGame.postGameSummary).toBeVisible();
}

async function listDeterministicReplays(window: Page): Promise<readonly ReplayListEntry[]> {
    return window.evaluate(
        (gameId) => (globalThis as unknown as ChimeraReplayGlobal).__chimera.replay.list(gameId),
        TACTICS_GAME_ID,
    );
}

/**
 * Save the just-finished match from the post-game summary → replay player → save
 * icon. Persisting is the SOLE gate now (the match is not written at game-over):
 * this seeds one deterministic replay, which is what enables the main-menu Replays
 * button and gives the library a row.
 */
async function saveDeterministicReplayFromSummary(
    hostWindow: Page,
    hostGame: GamePage,
): Promise<void> {
    await hostGame.replayButton.click();
    const player = new ReplayPlayerPage(hostWindow);
    await expect(player.playButton).toBeVisible({ timeout: 30_000 });
    await expect(player.saveButton).toBeEnabled();
    await player.save();
}

/** Read a saved replay file off disk and project the fields invariant #71 cares about. */
function readReplayFileShape(filePath: string): {
    readonly hasSeed: boolean;
    readonly actionCount: number;
    readonly hasFrames: boolean;
    readonly kind: string | null;
} {
    let buffer = readFileSync(filePath);
    // The serializer may gzip; detect the magic bytes and inflate if so.
    if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
        buffer = gunzipSync(buffer);
    }
    const json = JSON.parse(buffer.toString('utf8')) as {
        readonly seed?: unknown;
        readonly actions?: unknown;
        readonly frames?: unknown;
        readonly kind?: unknown;
    };
    return {
        hasSeed: json.seed !== undefined && json.seed !== null,
        actionCount: Array.isArray(json.actions) ? json.actions.length : -1,
        hasFrames: 'frames' in json,
        kind: typeof json.kind === 'string' ? json.kind : null,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('Tactics replay lifecycle', () => {
    test('post-game summary shows the Replay button and no Save Replay button', async ({
        hostWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);

        await expect(hostGame.replayButton).toBeVisible();
        // Saving moved into the replay player's compact icon.
        await expect(hostWindow.getByTestId('post-game-save-replay-btn')).toHaveCount(0);
    });

    test('the player save icon confirms success and persists a replay with seed + actions', async ({
        hostWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);

        // Open the finished match in the player (saveable), then save via its icon.
        await hostGame.replayButton.click();
        const player = new ReplayPlayerPage(hostWindow);
        await expect(player.playButton).toBeVisible({ timeout: 30_000 });
        await expect(player.saveButton).toBeEnabled();
        await player.save();

        const replays = await listDeterministicReplays(hostWindow);
        expect(replays.length).toBeGreaterThan(0);
        const [firstReplay] = replays;
        if (firstReplay === undefined) {
            throw new Error('expected at least one saved deterministic replay');
        }

        // Invariant #71: the deterministic file holds seed + actions and no
        // projected snapshots (and is not a perspective file).
        const shape = readReplayFileShape(firstReplay.path);
        expect(shape.hasSeed).toBe(true);
        expect(shape.actionCount).toBeGreaterThan(0);
        expect(shape.hasFrames).toBe(false);
        expect(shape.kind).toBeNull();
    });

    test('main-menu Replays button is disabled when no replays exist', async ({ hostWindow }) => {
        const mainMenu = new MainMenuPage(hostWindow);
        // Open the Tactics main menu before any match has been completed, so no
        // perspective replay exists yet. (gameId selects the Tactics menu, which
        // contributes the Replays button.)
        await mainMenu.goto({ gameId: TACTICS_GAME_ID });

        await expect(mainMenu.replaysButton).toBeVisible();
        await expect(mainMenu.replaysButton).toBeDisabled();
    });

    test('main-menu Replays button enables after saving a replay and opens the browser', async ({
        hostWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        // A finished match saves nothing on its own; the Replays button gates on a
        // saved replay (deterministic OR perspective), so persist one explicitly.
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);
        await saveDeterministicReplayFromSummary(hostWindow, hostGame);

        const mainMenu = new MainMenuPage(hostWindow);
        await mainMenu.goto({ gameId: TACTICS_GAME_ID });

        await expect(mainMenu.replaysButton).toBeEnabled();
        await mainMenu.replaysButton.click();

        await expect(hostWindow.getByTestId('replays-page')).toBeVisible();
    });

    test('main-menu Replays button stays disabled after a match that is not saved', async ({
        hostWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        // Regression guard for the "save-only" model: finishing (and abandoning) a
        // match must NOT auto-save any replay, so the Replays button stays disabled.
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);

        const mainMenu = new MainMenuPage(hostWindow);
        await mainMenu.goto({ gameId: TACTICS_GAME_ID });

        await expect(mainMenu.replaysButton).toBeVisible();
        await expect(mainMenu.replaysButton).toBeDisabled();
    });

    test('replaying a finished match advances to the final tick', async ({ hostWindow }) => {
        const hostGame = new GamePage(hostWindow);
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);

        // Capture the live outcome so we can assert the replay reproduces it.
        const liveResult = await hostWindow.evaluate(async () => {
            const snapshot = await (
                globalThis as unknown as ChimeraReplayGlobal
            ).__chimera.game.getCurrentSnapshot();
            return snapshot?.gameResult ?? null;
        });
        expect(liveResult).not.toBeNull();

        // The Replay button exports the finished match and opens it in the player.
        await hostGame.replayButton.click();

        const player = new ReplayPlayerPage(hostWindow);
        await expect(player.playButton).toBeVisible({ timeout: 30_000 });
        // Regression guard: opening from the post-game summary must not carry the
        // summary screen into the player (it would show an invalid Replay button).
        await expect(hostWindow.getByTestId('post-game-summary')).toHaveCount(0);

        const totalTicks = await player.totalTicks();
        expect(totalTicks).toBeGreaterThan(0);

        // Jump to one tick before the end, then Play the final tick. Bounded
        // regardless of the replay's length, since ticks advance in real time.
        await player.seekToPenultimateTick();
        await player.play();
        await player.waitForFinalTick();
        expect(await player.currentTick()).toBe(totalTicks);

        // Invariant #3: the player only ever receives a projected PlayerSnapshot
        // (identified by `viewerId`), never a raw GameSnapshot — and the replayed
        // outcome matches the original match.
        const replaySnapshot = await hostWindow.evaluate(
            (tick) =>
                (globalThis as unknown as ChimeraReplayGlobal).__chimera.replay.snapshotAt(tick),
            totalTicks,
        );
        expect(typeof replaySnapshot.viewerId).toBe('string');
        expect(replaySnapshot.gameResult?.winnerIds).toEqual(liveResult?.winnerIds);
    });

    test('a joined client opens its OWN perspective replay from the post-game summary', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);

        // Drive the shared two-peer match to game-over from the host; the client
        // receives the resolved snapshot (its result banner confirms it reached
        // game-over) and retains — but does NOT auto-save — its perspective replay.
        await playToGameOver(hostGame);
        await expect(clientGame.gameResultBanner).toBeVisible({ timeout: 60_000 });

        // The client reaches its post-game summary and presses Replay. The client
        // previews its OWN perspective replay from memory (the deterministic replay
        // stays host-only); nothing is written to disk unless it presses save.
        await goToPostGameSummary(clientWindow, clientGame);
        await expect(clientGame.replayButton).toBeVisible();
        await clientGame.replayButton.click();

        // It lands in the PERSPECTIVE player (the navigate push carried
        // kind=perspective), never the deterministic surface — the controls group
        // is labelled for the perspective kind.
        const player = new ReplayPlayerPage(clientWindow);
        await expect(player.playButton).toBeVisible({ timeout: 30_000 });
        await expect(
            clientWindow.getByRole('group', { name: 'Perspective replay playback controls' }),
        ).toBeVisible();
        // Regression guard: the replay player must never show the post-game
        // summary (and its invalid Replay button), even though we entered from it.
        await expect(clientWindow.getByTestId('post-game-summary')).toHaveCount(0);

        // The client's perspective plays back to its final tick.
        const totalTicks = await player.totalTicks();
        expect(totalTicks).toBeGreaterThan(0);
        await player.seekToPenultimateTick();
        await player.play();
        await player.waitForFinalTick();
        expect(await player.currentTick()).toBe(totalTicks);
    });

    test('leaving a post-game replay returns the host to the lobby', async ({ hostWindow }) => {
        const hostGame = new GamePage(hostWindow);
        const hostLobby = new LobbyPage(hostWindow);
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);

        // Open the just-finished match in the player (saveable=1 → post-game replay).
        await hostGame.replayButton.click();
        const player = new ReplayPlayerPage(hostWindow);
        await expect(player.playButton).toBeVisible({ timeout: 30_000 });

        // Esc opens the in-game leave dialog; confirming Leave must take the host
        // back to the lobby (the reported bug: it did nothing from the replay route).
        await hostWindow.keyboard.press('Escape');
        const leaveConfirm = hostWindow.getByTestId('tactics-leave-confirm');
        await expect(leaveConfirm).toBeVisible();
        await leaveConfirm.click();

        await expect(hostLobby.lobbyScreen).toBeVisible({ timeout: 30_000 });
    });

    test('leaving a library-opened replay returns to the replay library', async ({
        hostWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);

        // Persist a deterministic replay so the library has a row to open; saving
        // it also enables the Replays button (which gates on any saved replay).
        await saveDeterministicReplayFromSummary(hostWindow, hostGame);
        const player = new ReplayPlayerPage(hostWindow);

        // Reach the library the way a player does: main menu → Replays.
        const mainMenu = new MainMenuPage(hostWindow);
        await mainMenu.goto({ gameId: TACTICS_GAME_ID });
        await expect(mainMenu.replaysButton).toBeEnabled();
        await mainMenu.replaysButton.click();
        await expect(hostWindow.getByTestId('replays-page')).toBeVisible();

        // Open a saved replay from the library (saveable=0 → no live session).
        await hostWindow.getByTestId('replay-open-btn').first().click();
        await expect(player.playButton).toBeVisible({ timeout: 30_000 });

        // Esc → Leave must return to the replay library (not strand the player).
        await hostWindow.keyboard.press('Escape');
        const leaveConfirm = hostWindow.getByTestId('tactics-leave-confirm');
        await expect(leaveConfirm).toBeVisible();
        await leaveConfirm.click();

        await expect(hostWindow.getByTestId('replays-page')).toBeVisible({ timeout: 30_000 });
    });

    test('replay playback keeps the renderer heap within the §13.4 budget', async ({
        hostWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);

        // Open the finished match in the replay player and advance to the end, so
        // the full action list + reconstructed snapshots are resident in the
        // renderer — the residency the heap budget guards.
        await hostGame.replayButton.click();
        const player = new ReplayPlayerPage(hostWindow);
        await expect(player.playButton).toBeVisible({ timeout: 30_000 });
        await player.seekToPenultimateTick();
        await player.play();
        await player.waitForFinalTick();

        const heapMb = await readReplayHeapMb(hostWindow);

        console.log(
            `[perf] renderer heap (replay playback): ` +
                `${heapMb === null ? 'unavailable' : `${heapMb.toFixed(1)}MB`} ` +
                `(budget ${RENDERER_HEAP_BUDGET_MB}MB, strict=${PERF_STRICT})`,
        );

        test.skip(heapMb === null, 'performance.memory unavailable in this Chromium build');

        const label = `replay renderer heap ${(heapMb ?? 0).toFixed(1)}MB ≤ ${RENDERER_HEAP_BUDGET_MB}MB`;
        if (PERF_STRICT) {
            expect(heapMb ?? Infinity, label).toBeLessThanOrEqual(RENDERER_HEAP_BUDGET_MB);
        } else {
            if ((heapMb ?? Infinity) > RENDERER_HEAP_BUDGET_MB) {
                console.warn(`[perf][CI-informational] ${label} exceeded`);
            }
            expect.soft(heapMb ?? Infinity, label).toBeLessThanOrEqual(RENDERER_HEAP_BUDGET_MB);
        }
    });
});
