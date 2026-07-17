/**
 * F68 — save-load-ui.spec.ts (issue #829)
 * §13 E2E Testing (Playwright) · §4.11 Save/Load & Persistence
 *
 * Covers the full single-player save lifecycle through the SHIPPED UI — unlike
 * save-load.spec.ts (port 7785), which is IPC-driven (window.__chimera.saves.*
 * via page.evaluate) and predates the menu-load flow:
 *   1. Tactics main menu (?gameId=tactics) → New Game → host lobby → add AI →
 *      ready → start.
 *   2. Move a unit; record stamina + unit grid position.
 *   3. Save via the HUD save button → name modal (hud-save-btn → save-name-*).
 *   4. Host 3-step leave: Escape menu → confirm → lobby screen → leave lobby →
 *      Close → tactics main menu.
 *   5. Load Game → saves screen → load the row. GameStoreBootstrap routes
 *      /saves → /game once the restored snapshot lands (?gameId= preserved);
 *      stamina/position/tick must equal the step-2 values.
 *   6. A second move succeeds (live-session proof) and decrements stamina.
 *   7. Delete the save: Cancel keeps the row, Confirm empties the list.
 *
 * CRITICAL — never click `end-turn` in this spec. Autosave fires after every
 * successful engine:end_turn (HostSessionPipeline) and would (a) mint a
 * `tactics/autosave` row, breaking the exactly-one-row assertions, and
 * (b) clobber `__e2eHooks.lastSavedSlotId`/`lastSavedTick`. Moves only.
 *
 * The restore waiting overlay (`waiting-for-players-modal`) never appears here:
 * the coordinator enters `waiting` only for missing REMOTE seats, and a solo
 * host+AI save has none (AI seats are re-seeded host-side).
 *
 * Invariants upheld:
 *   #25 — the saving player is the host throughout: the UI-hosted lobby makes
 *          this window the host, and the menu-restore makes it host of the
 *          restored session too.
 *   #24 — the saves-screen load funnels through chimera:saves:load →
 *          SessionRestoreCoordinator; no internal APIs are called.
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or networking/.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { launchE2eElectronApplication, test as electronTest } from '../fixtures/electron.fixture';
import { getLastSavedSlotId, getLastSavedTick, getSimulationTick } from '../helpers/ipc-spy';
import { GamePage } from '../pages/GamePage';
import { InGameMenuPage } from '../pages/InGameMenuPage';
import { MainMenuPage } from '../pages/MainMenuPage';
import { SavesPage } from '../pages/SavesPage';
import { TacticsLobbyPage } from '../pages/TacticsLobbyPage';

// ─── Timing ──────────────────────────────────────────────────────────────────
// CI runs ~an order slower than local: canvas ops cost 6-11s and cross-screen
// hops several seconds. Never wrap the GamePage move helpers in shorter expect
// timeouts — they carry their own generous internal budgets.

const NAV_TIMEOUT_MS = 20_000;
const SHELL_LOAD_TIMEOUT_MS = 15_000;
/** Menu-restore budget: coordinator re-hosts + re-seats + applies checkpoint. */
const RESTORE_TIMEOUT_MS = 60_000;

const SAVE_LABEL = 'e2e-ui-save';

/** `'2/3'` → `'1/3'` — the expected readout after one more unit move. */
function decrementStamina(readout: string): string {
    const [current, max] = readout.split('/');
    if (current === undefined || max === undefined) {
        throw new Error(`Unexpected stamina readout: ${readout}`);
    }
    return `${parseInt(current, 10) - 1}/${max}`;
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

/**
 * Dedicated port for this spec; does not collide with base (7778), lobby
 * (7779), save-load (7785), or settings (7787/7788).
 */
const SAVE_LOAD_UI_PORT = '7786';

interface SaveLoadUiFixtures {
    readonly saveLoadUiApp: ElectronApplication;
    readonly saveLoadUiWindow: Page;
}

const test = electronTest.extend<SaveLoadUiFixtures>({
    // eslint-disable-next-line no-empty-pattern
    saveLoadUiApp: async ({}, use) => {
        // Menu boot: no directGameRole/passAndPlay — the spec drives hosting
        // through the real lobby UI. The gameId query is applied in-body via
        // MainMenuPage.goto so the spec exercises the menu→lobby navigation.
        const app = await launchE2eElectronApplication({
            port: SAVE_LOAD_UI_PORT,
            initialRoute: '/main-menu',
        });
        try {
            await use(app);
        } finally {
            await app.close().catch(() => undefined);
        }
    },

    saveLoadUiWindow: async ({ saveLoadUiApp }, use) => {
        const window = await saveLoadUiApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Host 3-step leave back to the tactics main menu: Escape menu → confirm leave
 * (host returns to the active lobby), leave the lobby (→ pre-lobby entry),
 * Close (→ main menu). Polls the menu labels so the shell is fully loaded.
 */
async function leaveMatchToMainMenu(
    inGameMenu: InGameMenuPage,
    lobby: TacticsLobbyPage,
    menu: MainMenuPage,
): Promise<void> {
    await inGameMenu.openViaEscape();
    await inGameMenu.confirmLeave();
    await expect(lobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await lobby.leaveLobby();
    await lobby.closeButton.click();
    await expect
        .poll(() => menu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
        .toContain('Load Game');
}

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe('Save / load — UI flow', () => {
    test('save via HUD, load from menu, play on, then delete via the saves screen', async ({
        saveLoadUiApp,
        saveLoadUiWindow,
    }) => {
        test.slow();

        const menu = new MainMenuPage(saveLoadUiWindow);
        const lobby = new TacticsLobbyPage(saveLoadUiWindow);
        const game = new GamePage(saveLoadUiWindow);
        const inGameMenu = new InGameMenuPage(saveLoadUiWindow);
        const saves = new SavesPage(saveLoadUiWindow);

        // 1. Tactics menu → New Game → host + 1 AI → ready → start.
        await menu.goto({ gameId: 'tactics' });
        await expect
            .poll(() => menu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
            .toContain('New Game');
        await menu.clickButtonByLabel('New Game');
        await expect(saveLoadUiWindow).toHaveURL(/\/lobby\/?\?gameId=tactics$/);
        await lobby.hostLobby();
        await lobby.addAi();
        await lobby.expectAiCount(1);
        await lobby.toggleReady();
        await expect(lobby.startButton).toBeEnabled({ timeout: NAV_TIMEOUT_MS });
        await lobby.startButton.click();

        // 2. Wait for the match, move a unit, record the state to restore.
        await expect(game.canvas).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await expect
            .poll(() => game.turnStatusText(), { timeout: NAV_TIMEOUT_MS })
            .toBe('Your turn');
        await game.moveOwnedUnitToOpenTile();
        const staminaAfterMove = await game.staminaText();
        const gridAfterMove = await game.localUnitGrid();

        // 3. Save through the HUD modal; the chimera:saves:save handler records
        //    the slot/tick on __e2eHooks (no new hooks — reused from #527).
        await game.saveGame(SAVE_LABEL);
        await expect
            .poll(() => getLastSavedSlotId(saveLoadUiApp), { timeout: 30_000 })
            .not.toBeNull();
        const savedTick = await getLastSavedTick(saveLoadUiApp);
        expect(savedTick).not.toBeNull();

        // 4. Back to the tactics main menu (host 3-step leave).
        await leaveMatchToMainMenu(inGameMenu, lobby, menu);

        // 5. Load Game → saves screen → load the single row → restored match.
        await menu.loadGameButton.click();
        await expect(saves.pageRoot).toBeVisible();
        expect(await saves.rowCount()).toBe(1);
        await saves.loadFirstSave();
        // No navigation happens on click; GameStoreBootstrap routes
        // /saves → /game (gameId preserved) once the restored snapshot lands.
        await expect(game.canvas).toBeVisible({ timeout: RESTORE_TIMEOUT_MS });
        await expect
            .poll(() => getSimulationTick(saveLoadUiApp), { timeout: RESTORE_TIMEOUT_MS })
            .toBe(savedTick);
        await expect
            .poll(() => game.turnStatusText(), { timeout: NAV_TIMEOUT_MS })
            .toBe('Your turn');
        await expect
            .poll(() => game.staminaText(), { timeout: NAV_TIMEOUT_MS })
            .toBe(staminaAfterMove);
        expect(await game.localUnitGrid()).toEqual(gridAfterMove);

        // 6. Live-session proof: a second move succeeds and costs stamina.
        await game.moveOwnedUnitToOpenTile();
        await expect
            .poll(() => game.staminaText(), { timeout: 30_000 })
            .toBe(decrementStamina(staminaAfterMove));

        // 7. Delete lifecycle: Cancel keeps the row, Confirm empties the list.
        await leaveMatchToMainMenu(inGameMenu, lobby, menu);
        await menu.loadGameButton.click();
        await expect(saves.pageRoot).toBeVisible();
        expect(await saves.rowCount()).toBe(1);
        await saves.requestDeleteFirstSave();
        await saves.cancelDelete();
        await expect(saves.rows).toHaveCount(1);
        await saves.requestDeleteFirstSave();
        await saves.confirmDelete();
        await expect(saves.rows).toHaveCount(0);
        // The empty caption renders only after loading resolves with zero
        // slots — this disambiguates count-0 from the transient loading state.
        await expect(saves.emptyState).toBeVisible();
    });
});
