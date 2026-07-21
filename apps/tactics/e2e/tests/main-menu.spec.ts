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
import { SYSTEM_QUIT_CHANNEL } from '../../../../electron/preload/apis/system-api';

const MAIN_MENU_QUIT_OBSERVED_KEY = '__chimeraMainMenuQuitObserved';

test.describe('Main Menu', () => {
    test.beforeEach(async ({ mainWindow }) => {
        const mainMenu = new MainMenuPage(mainWindow);
        // Deliberately NO `?gameId=`: this spec covers the engine's own default
        // main menu (Play / Settings / Quit). With no game context the engine
        // must stay game-agnostic — nothing from a game may reach this screen.
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

    test('the game-less menu is genuinely game-free — engine tokens and backdrop', async ({
        mainWindow,
    }) => {
        // The button labels alone cannot catch a game bleeding onto this screen:
        // a game's `:root` token override is injected by a CSS import with no
        // teardown, so it would theme the engine-default menu while every label
        // assertion still passed. Pin the engine's own token values instead.
        // The e2e tsconfig carries no DOM lib, so reach the browser globals
        // through a narrow cast (the same pattern as main-menu-custom.spec.ts).
        const probe = await mainWindow.evaluate(() => {
            const browser = globalThis as unknown as {
                document: { documentElement: unknown };
                getComputedStyle(element: unknown): { getPropertyValue(name: string): string };
            };
            const root = browser.getComputedStyle(browser.document.documentElement);
            return {
                accent: root.getPropertyValue('--ch-color-accent').trim(),
                backdropBlur: root.getPropertyValue('--ch-overlay-backdrop-blur').trim(),
            };
        });

        // renderer/styles/tokens.css — the engine's neutral zinc chrome.
        expect(probe.accent.toLowerCase()).toBe('#3f3f46');
        expect(probe.backdropBlur).toBe('0');

        const background = mainWindow.getByTestId('shell-background');
        await expect(background).toHaveAttribute('data-shell-background-kind', 'engine-default');
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
