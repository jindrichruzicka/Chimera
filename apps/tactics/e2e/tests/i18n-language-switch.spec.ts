/**
 * F71 — i18n-language-switch.spec.ts
 * §13.8 Core E2E Test Specifications — §4.39 Internationalization (i18n)
 *
 * Implements the E2E half of the F71 feature-review gate. Drives a
 * real UI-language switch on Tactics through the Settings page and asserts that
 * game-contributed strings re-translate, that the choice persists across a full
 * app relaunch (settings repository round-trip), and that a game with no declared
 * `languages` is inert (no selector, no settings Language row).
 *
 * Engine strings switch too: the Tactics CS bundle re-keys the FULL engine
 * token catalogue (parity-locked in
 * `apps/tactics/shell/translations/translations.test.tsx`), so the settings
 * dialog title, its Close action, and the Language field label are asserted in
 * Czech after the switch — engine tokens resolved through the game override
 * (Invariant #112 fallback chain, documented in §4.39).
 *
 * What this spec deliberately does NOT cover — and why (no silent gap):
 *   - The `engine.chat.title` engine-token override ("Match chat" → "Zápasový
 *     chat") renders only in-match, inside the collapsed ChatPanel mounted by
 *     `TacticsGameHud`. Re-driving it here would require the heavier direct-game
 *     fixture, entering a match, and expanding the chat drawer; instead the
 *     override-as-default-label contract is asserted in
 *     `renderer/components/chat/ChatPanel.test.tsx`, and the per-locale switch is
 *     covered by the Tactics translation parity test.
 *   - Debug token-mode is gated on the runtime debug flag, not on CHIMERA_E2E,
 *     and is covered by unit tests — excluded here per the same rule.
 *
 * The spec touches the renderer-facing Settings page + preload settings bridge
 * only; it never inspects GameSnapshot, SaveFile, or main-process internals.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import {
    expect,
    launchE2eElectronApplication,
    test as electronTest,
} from '../fixtures/electron.fixture';
import { captureRelaunchConfig, relaunchElectronApplication } from '../helpers/relaunch';
import { MainMenuPage } from '../pages/MainMenuPage';
import { SettingsPage } from '../pages/SettingsPage';

// --- Renderer bridge types ----------------------------------------------------
// Derived from electron/preload/api-types.ts without importing from that module.

interface RendererResolvedSettings {
    readonly gameplay?: {
        readonly language?: string;
    };
}

interface RendererSettingsBridge {
    get(gameId: string): Promise<RendererResolvedSettings>;
}

type RendererGlobal = typeof globalThis & {
    readonly __chimera: { readonly settings: RendererSettingsBridge };
};

// --- Constants ----------------------------------------------------------------

const I18N_SWITCH_PORT = '7791';
const I18N_INERT_PORT = '7792';
const TACTICS_GAME_ID = 'tactics';
const LOCALE_EN = 'en-US';
const LOCALE_CS = 'cs-CZ';

// Game-token labels rendered on the Tactics main menu (game.tactics.menu.*),
// paired English → Czech (see apps/tactics/shell/translations/{en,cs}.ts).
const NEW_GAME_EN = 'New Game';
const NEW_GAME_CS = 'Nová hra';
const SETTINGS_EN = 'Settings';
const SETTINGS_CS = 'Nastavení';

// Engine-token strings re-keyed per locale by the Tactics CS bundle — the
// engine ships English only, so the Czech renders prove the game override
// layer of the fallback chain on live engine UI (settings modal chrome).
const MODAL_TITLE_CS = 'Nastavení'; // engine.settings.modalTitle
const CLOSE_CS = 'Zavřít'; // engine.settings.close
const LANGUAGE_LABEL_CS = 'Jazyk'; // engine.settings.language
const END_TURN_DESCRIPTION_CS = 'Ukončit aktuální tah'; // game.tactics.actions.endTurn

// --- Helpers -----------------------------------------------------------------

async function readPersistedLanguage(page: Page, gameId: string): Promise<string> {
    return page.evaluate(async (id) => {
        const settings = await (globalThis as RendererGlobal).__chimera.settings.get(id);
        const language = settings.gameplay?.language;
        if (typeof language !== 'string') {
            throw new Error('settings.gameplay.language was not a string');
        }
        return language;
    }, gameId);
}

/** Boot the Tactics main menu (URL `?gameId=tactics`) and wait for its shell to render. */
async function gotoTacticsMenu(window: Page): Promise<MainMenuPage> {
    const menu = new MainMenuPage(window);
    await menu.goto({ gameId: TACTICS_GAME_ID });
    // Poll until the URL-selected tactics shell has loaded its game-token menu.
    await expect.poll(() => menu.getButtonLabels(), { timeout: 15_000 }).toContain(NEW_GAME_EN);
    return menu;
}

// --- Fixtures ----------------------------------------------------------------

interface I18nSwitchFixtures {
    readonly menuApp: ElectronApplication;
    readonly menuWindow: Page;
}

const test = electronTest.extend<I18nSwitchFixtures>({
    // eslint-disable-next-line no-empty-pattern
    menuApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({ port: I18N_SWITCH_PORT });
        try {
            await use(app);
        } finally {
            await app.close().catch(() => undefined);
        }
    },

    menuWindow: async ({ menuApp }, use) => {
        const window = await menuApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        // Occluded Playwright windows freeze CSS transition clocks; collapse the
        // settings Modal / tab transitions so driving them never stalls.
        await window.emulateMedia({ reducedMotion: 'reduce' });
        await use(window);
    },
});

// --- Spec --------------------------------------------------------------------

test.describe('i18n language switch (F71)', () => {
    test('switching EN → CS re-translates game strings and persists across relaunch', async ({
        menuApp,
        menuWindow,
    }) => {
        let liveApp = menuApp;

        try {
            const menu = await gotoTacticsMenu(menuWindow);

            // Baseline: English game tokens on the tactics main menu.
            let labels = await menu.getButtonLabels();
            expect(labels).toContain(NEW_GAME_EN);
            expect(labels).toContain(SETTINGS_EN);

            // Open Settings (preserving game context), switch the Gameplay-tab
            // Language field to Czech, then close back to the menu.
            await menu.clickButtonByLabel(SETTINGS_EN);
            await expect(menuWindow).toHaveURL(/\/settings\/?\?gameId=tactics$/);

            const settingsPage = new SettingsPage(menuWindow);
            // Assert the dialog testid, never body visibility (zero-height body).
            await expect(menuWindow.getByTestId('settings-dialog')).toBeVisible();

            // Open the Gameplay tab (by locale-independent testid) and flip locale.
            await settingsPage.clickTabById('gameplay');
            await expect(settingsPage.languageSelect).toBeVisible();
            expect(await settingsPage.currentLanguage()).toBe(LOCALE_EN);

            await settingsPage.selectLanguage(LOCALE_CS);

            // ENGINE strings re-render in Czech in the still-open dialog: the
            // modal title, the Close action, and the Language field label are
            // engine tokens resolved through the Tactics CS override bundle.
            await expect(
                menuWindow.getByTestId('settings-dialog').getByRole('heading', {
                    name: MODAL_TITLE_CS,
                }),
            ).toBeVisible();
            await expect(settingsPage.closeButton).toHaveText(CLOSE_CS);
            await expect(settingsPage.languageSelect).toHaveAccessibleName(LANGUAGE_LABEL_CS);

            // The Controls panel resolves the game's tokenized input-action
            // description too ('End current turn' → 'Ukončit aktuální tah').
            await settingsPage.clickTabById('controls');
            await expect(settingsPage.bindingDescription('game:end-turn')).toHaveText(
                END_TURN_DESCRIPTION_CS,
            );

            await settingsPage.close();
            await expect(menuWindow).toHaveURL(/\/main-menu\/?\?gameId=tactics$/);

            // Live switch: the menu game tokens now render in Czech, no reload.
            await expect.poll(() => menu.getButtonLabels()).toContain(NEW_GAME_CS);
            labels = await menu.getButtonLabels();
            expect(labels).toContain(NEW_GAME_CS);
            expect(labels).toContain(SETTINGS_CS);
            expect(labels).not.toContain(NEW_GAME_EN);

            // The choice is persisted for the tactics game context.
            await expect
                .poll(() => readPersistedLanguage(menuWindow, TACTICS_GAME_ID))
                .toBe(LOCALE_CS);

            // Relaunch the whole app: the persisted locale must apply on the COLD
            // boot to the main menu itself — SettingsBootstrap hydrates the URL
            // `?gameId=` game's persisted settings, so the menu renders Czech
            // without opening any other surface first.
            const relaunchConfig = await captureRelaunchConfig(liveApp);
            await liveApp.close();

            const relaunchedApp = await relaunchElectronApplication(relaunchConfig);
            liveApp = relaunchedApp;
            const relaunchedWindow = await relaunchedApp.firstWindow();
            await relaunchedWindow.waitForLoadState('domcontentloaded');
            await relaunchedWindow.emulateMedia({ reducedMotion: 'reduce' });

            // Repository round-trip: the persisted locale is still Czech on disk.
            expect(await readPersistedLanguage(relaunchedWindow, TACTICS_GAME_ID)).toBe(LOCALE_CS);

            // The cold main menu renders the persisted Czech directly.
            const relaunchedMenu = new MainMenuPage(relaunchedWindow);
            await relaunchedMenu.goto({ gameId: TACTICS_GAME_ID });
            await expect
                .poll(() => relaunchedMenu.getButtonLabels(), { timeout: 15_000 })
                .toContain(NEW_GAME_CS);

            // And the Settings page shows the persisted locale in the Language
            // field. The menu is Czech, so navigate by the Czech label; tabs are
            // clicked by locale-independent testid ("Gameplay" → "Hratelnost").
            await relaunchedMenu.clickButtonByLabel(SETTINGS_CS);
            await expect(relaunchedWindow).toHaveURL(/\/settings\/?\?gameId=tactics$/);

            const relaunchedSettings = new SettingsPage(relaunchedWindow);
            await expect(relaunchedWindow.getByTestId('settings-dialog')).toBeVisible();
            await relaunchedSettings.clickTabById('gameplay');
            await expect(relaunchedSettings.languageSelect).toBeVisible();
            await expect
                .poll(() => relaunchedSettings.currentLanguage(), { timeout: 10_000 })
                .toBe(LOCALE_CS);
        } finally {
            await liveApp.close().catch(() => undefined);
        }
    });
});

// --- Single-language inertness -----------------------------------------------

interface InertFixtures {
    readonly inertApp: ElectronApplication;
    readonly inertWindow: Page;
}

const inertTest = electronTest.extend<InertFixtures>({
    // eslint-disable-next-line no-empty-pattern
    inertApp: async ({}, use) => {
        // Boot straight to /settings with NO gameId — the engine settings context
        // (`__engine__`) declares no languages, so the selector must self-hide.
        const app = await launchE2eElectronApplication({
            port: I18N_INERT_PORT,
            initialRoute: '/settings',
        });
        try {
            await use(app);
        } finally {
            await app.close().catch(() => undefined);
        }
    },

    inertWindow: async ({ inertApp }, use) => {
        const window = await inertApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await window.emulateMedia({ reducedMotion: 'reduce' });
        await use(window);
    },
});

inertTest.describe('i18n single-language inertness (F71)', () => {
    inertTest(
        'a game with no declared languages shows no selector and no settings Language row',
        async ({ inertWindow }) => {
            const settingsPage = new SettingsPage(inertWindow);

            // The engine-default settings shell renders (dialog + Gameplay tab).
            await expect(inertWindow.getByTestId('settings-dialog')).toBeVisible();
            await settingsPage.clickTabById('gameplay');

            // No Language combobox exists — SettingsLanguageSelector renders null
            // for a context declaring fewer than two languages (Invariant #111).
            await expect(settingsPage.languageSelect).toHaveCount(0);
        },
    );
});
