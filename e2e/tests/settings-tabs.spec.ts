/**
 * Settings tabs E2E coverage for issue #631.
 *
 * Verifies the engine-default tab surface, tab navigation, tactics override
 * tabs, value persistence across renderer reload, and reset-to-defaults flow.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from '../../electron/main/renderer-url';
import { expect, launchE2eElectronApplication, test } from '../fixtures/electron.fixture';
import { SettingsPage } from '../pages/SettingsPage';

const SETTINGS_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/settings/`;
const TACTICS_SETTINGS_PORT = '7788';
const PERSISTED_MASTER_VOLUME = 0.37;
const DEFAULT_MASTER_VOLUME = 1.0;

async function openSettingsPage(page: Page): Promise<SettingsPage> {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('domcontentloaded');
    const settingsPage = new SettingsPage(page);
    await expect(settingsPage.getControlByLabel('Master Volume')).toBeVisible({ timeout: 10_000 });
    return settingsPage;
}

async function readDisplayedMasterVolume(settingsPage: SettingsPage): Promise<number> {
    return Number(await settingsPage.getControlByLabel('Master Volume').inputValue());
}

async function expectDisplayedMasterVolume(
    settingsPage: SettingsPage,
    expectedValue: number,
): Promise<void> {
    await expect
        .poll(() => readDisplayedMasterVolume(settingsPage), { timeout: 10_000 })
        .toBeCloseTo(expectedValue, 2);
}

async function launchTacticsSettingsApp(): Promise<ElectronApplication> {
    return launchE2eElectronApplication({
        port: TACTICS_SETTINGS_PORT,
        role: 'host',
        directGameRole: 'host',
        initialRoute: '/settings',
    });
}

test.describe('Settings tabs', () => {
    test('engine default tabs are visible and Audio is initially selected', async ({
        mainWindow,
    }) => {
        await openSettingsPage(mainWindow);

        const expectedTabs = ['Audio', 'Display', 'Gameplay', 'Controls'] as const;
        for (const label of expectedTabs) {
            await expect(mainWindow.getByRole('tab', { name: label, exact: true })).toBeVisible();
        }

        await expect(mainWindow.getByRole('tab')).toHaveCount(expectedTabs.length);
        await expect(mainWindow.getByRole('tab', { name: 'Audio', exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    test('tab navigation shows display controls and key rebinding UI', async ({ mainWindow }) => {
        const settingsPage = await openSettingsPage(mainWindow);

        await settingsPage.clickTab('Display');
        await expect(settingsPage.getControlByLabel('Fullscreen')).toBeVisible();
        await expect(settingsPage.getControlByLabel('Target FPS')).toBeVisible();

        await settingsPage.clickTab('Controls');
        await expect(settingsPage.bindingValue('engine:undo')).toBeVisible({ timeout: 10_000 });
    });

    test('tactics active game shows gameplay and AI override tabs', async () => {
        const app = await launchTacticsSettingsApp();
        try {
            const window = await app.firstWindow();
            await window.waitForLoadState('domcontentloaded');
            const settingsPage = new SettingsPage(window);

            const expectedTabs = ['Audio', 'Display', 'Gameplay', 'AI', 'Controls'] as const;
            for (const label of expectedTabs) {
                await expect(window.getByRole('tab', { name: label, exact: true })).toBeVisible({
                    timeout: 10_000,
                });
            }

            await settingsPage.clickTab('Gameplay');
            await expect(settingsPage.getControlByLabel('Show Grid')).toBeVisible();
            await expect(settingsPage.getControlByLabel('Animation Speed')).toBeVisible();

            await settingsPage.clickTab('AI');
            await expect(settingsPage.getControlByLabel('AI Thinking Delay')).toHaveAttribute(
                'type',
                'range',
            );
        } finally {
            await app.close().catch(() => undefined);
        }
    });

    test('master volume persists after reloading the settings page', async ({ mainWindow }) => {
        const settingsPage = await openSettingsPage(mainWindow);

        await settingsPage.setSlider('Master Volume', PERSISTED_MASTER_VOLUME);
        await expectDisplayedMasterVolume(settingsPage, PERSISTED_MASTER_VOLUME);

        await mainWindow.reload();
        await mainWindow.waitForLoadState('domcontentloaded');

        await expectDisplayedMasterVolume(new SettingsPage(mainWindow), PERSISTED_MASTER_VOLUME);
    });

    test('reset to defaults restores default settings values', async ({ mainWindow }) => {
        const settingsPage = await openSettingsPage(mainWindow);

        await settingsPage.setSlider('Master Volume', PERSISTED_MASTER_VOLUME);
        await expectDisplayedMasterVolume(settingsPage, PERSISTED_MASTER_VOLUME);

        await settingsPage.resetToDefaults();

        await expectDisplayedMasterVolume(settingsPage, DEFAULT_MASTER_VOLUME);
    });
});
