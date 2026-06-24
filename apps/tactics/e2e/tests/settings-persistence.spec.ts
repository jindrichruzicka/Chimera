/**
 * F34 - settings-persistence.spec.ts
 * Section 13.8 Core E2E Test Specifications - Section 4.13 Settings System
 *
 * Part of #526. Implements issue #529.
 *
 * Verifies settings persistence through the renderer-facing Settings page and
 * preload bridge only. The spec intentionally does not inspect GameSnapshot,
 * SaveFile, PlayerSnapshot, simulation state, or main-process internals.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import {
    expect,
    launchE2eElectronApplication,
    test as electronTest,
} from '../fixtures/electron.fixture';
import { captureRelaunchConfig, relaunchElectronApplication } from '../helpers/relaunch';
import { SettingsPage } from '../pages/SettingsPage';

// --- Renderer bridge types ----------------------------------------------------
// Derived from electron/preload/api-types.ts without importing from that module.

interface RendererResolvedSettings {
    readonly audio?: {
        readonly masterVolume?: number;
    };
}

interface RendererSettingsBridge {
    get(gameId: string): Promise<RendererResolvedSettings>;
}

type RendererGlobal = typeof globalThis & {
    readonly __chimera: { readonly settings: RendererSettingsBridge };
};

// --- Helpers -----------------------------------------------------------------

const SETTINGS_PERSISTENCE_PORT = '7787';
const ENGINE_SETTINGS_GAME_ID = '__engine__';
const PERSISTED_MASTER_VOLUME = 0.42;
const DEFAULT_MASTER_VOLUME = 1.0;

interface RelaunchedSettingsApp {
    readonly app: ElectronApplication;
    readonly window: Page;
}

async function readPersistedMasterVolume(page: Page): Promise<number> {
    return page.evaluate(async (gameId) => {
        const settings = await (globalThis as RendererGlobal).__chimera.settings.get(gameId);
        const masterVolume = settings.audio?.masterVolume;
        if (typeof masterVolume !== 'number') {
            throw new Error('settings.audio.masterVolume was not a number');
        }
        return masterVolume;
    }, ENGINE_SETTINGS_GAME_ID);
}

async function readDisplayedMasterVolume(settingsPage: SettingsPage): Promise<number> {
    return Number(await settingsPage.masterVolumeInput.inputValue());
}

async function expectDisplayedMasterVolume(
    settingsPage: SettingsPage,
    expectedValue: number,
): Promise<void> {
    await expect
        .poll(() => readDisplayedMasterVolume(settingsPage), { timeout: 10_000 })
        .toBeCloseTo(expectedValue, 2);
}

async function expectPersistedMasterVolume(page: Page, expectedValue: number): Promise<void> {
    await expect
        .poll(() => readPersistedMasterVolume(page), { timeout: 10_000 })
        .toBeCloseTo(expectedValue, 2);
}

async function relaunchSettingsApp(app: ElectronApplication): Promise<RelaunchedSettingsApp> {
    const relaunchConfig = await captureRelaunchConfig(app);
    await app.close();

    const relaunchedApp = await relaunchElectronApplication(relaunchConfig);
    try {
        const relaunchedWindow = await relaunchedApp.firstWindow();
        await relaunchedWindow.waitForLoadState('domcontentloaded');
        return { app: relaunchedApp, window: relaunchedWindow };
    } catch (error) {
        await relaunchedApp.close().catch(() => undefined);
        throw error;
    }
}

// --- Fixture -----------------------------------------------------------------

interface SettingsPersistenceFixtures {
    readonly settingsApp: ElectronApplication;
    readonly settingsWindow: Page;
}

const test = electronTest.extend<SettingsPersistenceFixtures>({
    // eslint-disable-next-line no-empty-pattern
    settingsApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: SETTINGS_PERSISTENCE_PORT,
            initialRoute: '/settings',
        });
        try {
            await use(app);
        } finally {
            await app.close().catch(() => undefined);
        }
    },

    settingsWindow: async ({ settingsApp }, use) => {
        const window = await settingsApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

// --- Spec --------------------------------------------------------------------

test.describe('Settings persistence', () => {
    test('masterVolume persists across relaunch', async ({ settingsApp, settingsWindow }) => {
        let liveApp = settingsApp;
        const settingsPage = new SettingsPage(settingsWindow);

        try {
            await settingsPage.setMasterVolume(PERSISTED_MASTER_VOLUME);
            await expectPersistedMasterVolume(settingsWindow, PERSISTED_MASTER_VOLUME);

            const relaunched = await relaunchSettingsApp(liveApp);
            liveApp = relaunched.app;

            await expectDisplayedMasterVolume(
                new SettingsPage(relaunched.window),
                PERSISTED_MASTER_VOLUME,
            );
        } finally {
            await liveApp.close().catch(() => undefined);
        }
    });

    test('reset returns masterVolume to default and persists across relaunch', async ({
        settingsApp,
        settingsWindow,
    }) => {
        let liveApp = settingsApp;
        let liveWindow = settingsWindow;

        try {
            await new SettingsPage(liveWindow).setMasterVolume(PERSISTED_MASTER_VOLUME);
            await expectPersistedMasterVolume(liveWindow, PERSISTED_MASTER_VOLUME);

            const persistedRelaunch = await relaunchSettingsApp(liveApp);
            liveApp = persistedRelaunch.app;
            liveWindow = persistedRelaunch.window;

            const persistedSettingsPage = new SettingsPage(liveWindow);
            await expectDisplayedMasterVolume(persistedSettingsPage, PERSISTED_MASTER_VOLUME);

            await persistedSettingsPage.resetToDefaults();
            await expectDisplayedMasterVolume(persistedSettingsPage, DEFAULT_MASTER_VOLUME);
            await expectPersistedMasterVolume(liveWindow, DEFAULT_MASTER_VOLUME);

            const resetRelaunch = await relaunchSettingsApp(liveApp);
            liveApp = resetRelaunch.app;
            liveWindow = resetRelaunch.window;

            await expectDisplayedMasterVolume(new SettingsPage(liveWindow), DEFAULT_MASTER_VOLUME);
        } finally {
            await liveApp.close().catch(() => undefined);
        }
    });
});
