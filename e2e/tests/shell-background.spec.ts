/**
 * Shell background E2E coverage.
 *
 * Verifies the persistent shell background host across main menu, settings, and
 * lobby, plus the hard boundary that match GameShell routes do not render it.
 */

import type { Page } from '@playwright/test';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from '../../electron/main/renderer-url';
import { expect, test as electronTest } from '../fixtures/electron.fixture';
import { test as gameTest } from '../fixtures/game.fixture';
import { MainMenuPage } from '../pages/MainMenuPage';
import { SettingsPage } from '../pages/SettingsPage';

const LOBBY_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/lobby/`;

async function shellBackgroundInstanceId(page: Page): Promise<string> {
    const value = await page
        .getByTestId('shell-background')
        .getAttribute('data-shell-background-instance-id');
    if (value === null) {
        throw new Error('Shell background host did not expose an instance id');
    }
    return value;
}

electronTest.describe('Shell background host', () => {
    electronTest(
        'engine default main menu uses the solid shell background',
        async ({ mainWindow }) => {
            const menu = new MainMenuPage(mainWindow);
            await menu.goto();

            const shellBackground = mainWindow.getByTestId('shell-background');
            await expect(shellBackground).toBeVisible();
            await expect(shellBackground).toHaveAttribute(
                'data-shell-background-kind',
                'engine-default',
            );
            await expect(mainWindow.getByTestId('tactics-shell-background')).toHaveCount(0);
        },
    );

    electronTest(
        'tactics background persists across main-menu and settings navigation',
        async ({ mainWindow }) => {
            const menu = new MainMenuPage(mainWindow);
            await menu.goto({ gameId: 'tactics' });

            await expect(mainWindow.getByTestId('tactics-shell-background')).toBeVisible({
                timeout: 15_000,
            });
            const firstInstanceId = await shellBackgroundInstanceId(mainWindow);

            await menu.clickButtonByLabel('Settings');
            await expect(mainWindow).toHaveURL(/\/settings\/?\?gameId=tactics$/);
            await expect(mainWindow.getByTestId('tactics-shell-background')).toBeVisible();
            expect(await shellBackgroundInstanceId(mainWindow)).toBe(firstInstanceId);

            const settingsPage = new SettingsPage(mainWindow);
            await settingsPage.close();
            await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=tactics$/);
            await expect(mainWindow.getByTestId('tactics-shell-background')).toBeVisible();
            expect(await shellBackgroundInstanceId(mainWindow)).toBe(firstInstanceId);
        },
    );

    electronTest(
        'tactics background persists from main-menu to lobby when launch game context is explicit',
        async ({ mainWindow }) => {
            const menu = new MainMenuPage(mainWindow);
            await menu.goto({ gameId: 'tactics' });

            await expect(mainWindow.getByTestId('tactics-shell-background')).toBeVisible({
                timeout: 15_000,
            });
            const firstInstanceId = await shellBackgroundInstanceId(mainWindow);

            await menu.clickButtonByLabel('New Game');
            await expect(mainWindow).toHaveURL(/\/lobby\/?\?gameId=tactics$/);
            await expect(mainWindow.getByTestId('tactics-shell-background')).toBeVisible();
            expect(await shellBackgroundInstanceId(mainWindow)).toBe(firstInstanceId);
        },
    );

    electronTest(
        'lobby route renders the tactics shell background for its game context',
        async ({ mainWindow }) => {
            await mainWindow.goto(`${LOBBY_URL}?gameId=tactics`);

            const shellBackground = mainWindow.getByTestId('shell-background');
            await expect(shellBackground).toBeVisible({ timeout: 15_000 });
            await expect(shellBackground).toHaveAttribute('data-shell-background-kind', 'game');
            await expect(shellBackground).toHaveAttribute('data-shell-game-id', 'tactics');
            await expect(mainWindow.getByTestId('tactics-shell-background')).toBeVisible();
        },
    );
});

gameTest(
    'game scene does not render the shell background host',
    async ({ hostWindow, clientWindow }) => {
        await expect(hostWindow.getByTestId('game-canvas')).toBeVisible();
        await expect(clientWindow.getByTestId('game-canvas')).toBeVisible();

        await expect(hostWindow.getByTestId('shell-background')).toHaveCount(0);
        await expect(clientWindow.getByTestId('shell-background')).toHaveCount(0);
    },
);
