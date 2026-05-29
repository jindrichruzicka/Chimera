/**
 * F31 — main-menu.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies the Main Menu screen at /main-menu:
 *   - Play button navigates to /lobby
 *   - Settings button navigates to /settings
 *   - Quit button calls window.__chimera.system.quit()
 *
 * Invariant 4: The Quit button must call window.__chimera.system.quit() —
 * never require('electron') or any direct Node API.
 */
import { test, expect } from '../fixtures/electron.fixture';
import { MainMenuPage } from '../pages/MainMenuPage';
import { SYSTEM_QUIT_CHANNEL } from '../../electron/preload/apis/system-api';

const MAIN_MENU_QUIT_OBSERVED_KEY = '__chimeraMainMenuQuitObserved';

test.describe('Main Menu', () => {
    test.beforeEach(async ({ mainWindow }) => {
        const mainMenu = new MainMenuPage(mainWindow);
        await mainMenu.goto();
    });

    test('Component gallery button is visible in E2E mode and navigates to /component-gallery', async ({
        mainWindow,
    }) => {
        const mainMenu = new MainMenuPage(mainWindow);

        await expect(mainMenu.componentGalleryButton).toBeVisible();
        await mainMenu.openComponentGallery();

        await expect(mainWindow).toHaveURL(/\/component-gallery/);
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

    test('Quit button sends the system quit IPC in E2E mode', async ({
        electronApp,
        mainWindow,
    }) => {
        await electronApp.evaluate(
            ({ ipcMain }, params) => {
                Object.defineProperty(globalThis, params.observedKey, {
                    configurable: true,
                    value: false,
                    writable: true,
                });

                ipcMain.once(params.quitChannel, () => {
                    Object.defineProperty(globalThis, params.observedKey, {
                        configurable: true,
                        value: true,
                        writable: true,
                    });
                });
            },
            {
                observedKey: MAIN_MENU_QUIT_OBSERVED_KEY,
                quitChannel: SYSTEM_QUIT_CHANNEL,
            },
        );

        const mainMenu = new MainMenuPage(mainWindow);
        await mainMenu.quit();

        await expect
            .poll(() =>
                electronApp.evaluate((_electron, observedKey) => {
                    const descriptor = Object.getOwnPropertyDescriptor(globalThis, observedKey);
                    return descriptor?.value === true;
                }, MAIN_MENU_QUIT_OBSERVED_KEY),
            )
            .toBe(true);
    });
});
