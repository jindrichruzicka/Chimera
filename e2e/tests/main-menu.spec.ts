/**
 * F31 — main-menu.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies the Main Menu screen at /main-menu:
 *   - Play button navigates to /lobby
 *   - Settings button navigates to /settings
 *   - Quit button calls window.__chimera.system.quit() via __e2eHooks
 *
 * Invariant 4: The Quit button must call window.__chimera.system.quit() —
 * never require('electron') or any direct Node API.
 */
import { test, expect } from '../fixtures/electron.fixture';
import { MainMenuPage } from '../pages/MainMenuPage';

test.describe('Main Menu', () => {
    test.beforeEach(async ({ mainWindow }) => {
        const mainMenu = new MainMenuPage(mainWindow);
        await mainMenu.goto();
    });

    test('Play button navigates to /lobby', async ({ mainWindow }) => {
        const mainMenu = new MainMenuPage(mainWindow);
        await mainMenu.navigateToLobby();
        await expect(mainWindow).toHaveURL(/\/lobby/);
    });

    test('Settings button navigates to /settings', async ({ mainWindow }) => {
        const mainMenu = new MainMenuPage(mainWindow);
        await mainMenu.navigateToSettings();
        await expect(mainWindow).toHaveURL(/\/settings/);
    });

    test('Quit button calls window.__chimera.system.quit via __e2eHooks', async ({
        mainWindow,
    }) => {
        // Intercept via renderer-side __e2eHooks so the real app-quit IPC is
        // shadowed. The preload calls onSystemQuit before forwarding the IPC;
        // the main-process handler is a no-op in CHIMERA_E2E=1 mode.
        const quitCalled = mainWindow.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    const g = globalThis as unknown as Record<string, Record<string, unknown>>;
                    g['__e2eHooks'] = { ...(g['__e2eHooks'] ?? {}), onSystemQuit: resolve };
                }),
        );

        const mainMenu = new MainMenuPage(mainWindow);
        await mainMenu.quit();
        await quitCalled;
    });
});
