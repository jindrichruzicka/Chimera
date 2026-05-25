/**
 * F40 — input-keybindings.spec.ts
 *
 * Verifies a game-owned input binding can be changed through the settings UI,
 * used in-game, and reset back to the current resolved default value.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from '../../electron/main/renderer-url';
import { test, expect } from '../fixtures/direct-game.fixture';
import { launchE2eElectronApplication } from '../fixtures/electron.fixture';
import { GamePage } from '../pages/GamePage';
import { SettingsPage } from '../pages/SettingsPage';

const GAME_ID = 'tactics';
const END_TURN_ACTION_ID = 'game:end-turn';
const REBOUND_KEY = 'KeyK';
const DIRECT_GAME_PORT = '7779';
const LOBBY_CODE_POLL_MS = 100;
const LOBBY_CODE_TIMEOUT_MS = 10_000;
const GAME_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/game/`;

interface RendererKeyBinding {
    readonly primary: string;
    readonly secondary: string | null;
    readonly modifiers: readonly string[];
}

type RendererGlobal = typeof globalThis & {
    readonly __chimera: {
        readonly settings: {
            get(gameId: string): Promise<{
                readonly controls?: {
                    readonly bindings?: Record<string, Partial<RendererKeyBinding>>;
                };
            }>;
            update(
                gameId: string,
                patch: {
                    readonly controls: {
                        readonly bindings: Record<string, Partial<RendererKeyBinding>>;
                    };
                },
            ): Promise<unknown>;
        };
    };
};

async function readActionBinding(page: Page, actionId: string): Promise<RendererKeyBinding> {
    return page.evaluate(
        async ({ gameId, inputActionId }) => {
            const settings = await (globalThis as RendererGlobal).__chimera.settings.get(gameId);
            const binding = settings.controls?.bindings?.[inputActionId];
            if (typeof binding?.primary !== 'string') {
                throw new Error(`Missing binding for ${inputActionId}`);
            }
            return {
                primary: binding.primary,
                secondary: typeof binding.secondary === 'string' ? binding.secondary : null,
                modifiers: Array.isArray(binding.modifiers) ? binding.modifiers : [],
            } satisfies RendererKeyBinding;
        },
        { gameId: GAME_ID, inputActionId: actionId },
    );
}

function formatBinding(binding: RendererKeyBinding): string {
    const modifiers = binding.modifiers.length > 0 ? `${binding.modifiers.join('+')}+` : '';
    return `${modifiers}${binding.primary}`;
}

async function resetActionBindingToDefault(page: Page, actionId: string): Promise<void> {
    await page.evaluate(
        async ({ gameId, inputActionId }) => {
            const settingsBridge = (globalThis as RendererGlobal).__chimera.settings;
            const settings = await settingsBridge.get(gameId);
            const bindings = { ...(settings.controls?.bindings ?? {}) };
            delete bindings[inputActionId];
            await settingsBridge.update(gameId, { controls: { bindings } });
        },
        { gameId: GAME_ID, inputActionId: actionId },
    );
}

async function waitForDirectGameLobbyCode(hostApp: ElectronApplication): Promise<string> {
    const deadline = Date.now() + LOBBY_CODE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const lobbyCode: string | null = await hostApp.evaluate(() => {
            type E2eHookGlobal = typeof globalThis & {
                __e2eHooks?: { directGameLobbyCode: string | null };
            };
            return (globalThis as E2eHookGlobal).__e2eHooks?.directGameLobbyCode ?? null;
        });
        if (lobbyCode !== null) {
            return lobbyCode;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, LOBBY_CODE_POLL_MS));
    }
    throw new Error('Timed out waiting for direct-game lobby code');
}

async function launchDirectGameClient(hostApp: ElectronApplication): Promise<ElectronApplication> {
    const lobbyCode = await waitForDirectGameLobbyCode(hostApp);
    return launchE2eElectronApplication({
        port: DIRECT_GAME_PORT,
        role: 'client',
        directGameRole: 'client',
        directGameJoinAddress: lobbyCode,
        initialRoute: '/game',
    });
}

test.describe('Input keybindings', () => {
    test.use({ hostInitialRoute: '/settings', launchClient: false, waitForGameStarted: false });

    test('rebinds end turn, triggers it from keyboard, and resets to default', async ({
        hostApp,
        hostWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        let defaultBinding: RendererKeyBinding | null = null;
        let clientApp: ElectronApplication | null = null;

        try {
            defaultBinding = await readActionBinding(hostWindow, END_TURN_ACTION_ID);

            await hostWindow.waitForLoadState('domcontentloaded');
            const settingsPage = new SettingsPage(hostWindow);
            await expect(settingsPage.masterVolumeInput).toBeVisible({ timeout: 10_000 });
            await settingsPage.clickTab('Controls');

            await expect(settingsPage.bindingValue(END_TURN_ACTION_ID)).toHaveText(
                formatBinding(defaultBinding),
                { timeout: 10_000 },
            );

            await settingsPage.startRebinding(END_TURN_ACTION_ID);
            await expect(settingsPage.bindingValue(END_TURN_ACTION_ID)).toHaveText(/Press a key/, {
                timeout: 10_000,
            });
            await hostWindow.keyboard.press(REBOUND_KEY);

            await expect(settingsPage.bindingValue(END_TURN_ACTION_ID)).toHaveText(REBOUND_KEY, {
                timeout: 10_000,
            });
            await expect
                .poll(() => readActionBinding(hostWindow, END_TURN_ACTION_ID), { timeout: 10_000 })
                .toEqual({ primary: REBOUND_KEY, secondary: null, modifiers: [] });

            clientApp = await launchDirectGameClient(hostApp);
            const clientWindow = await clientApp.firstWindow();
            await clientWindow.waitForLoadState('domcontentloaded');
            const clientGame = new GamePage(clientWindow);
            await expect(clientGame.canvas).toBeVisible({ timeout: 15_000 });

            await hostWindow.goto(GAME_URL);
            await hostWindow.waitForLoadState('domcontentloaded');
            await expect(hostGame.canvas).toBeVisible({ timeout: 15_000 });
            await expect(hostGame.endTurnButton).toBeEnabled({ timeout: 10_000 });

            const tickBeforeKeypress = await hostGame.currentTick();
            await hostWindow.keyboard.press(REBOUND_KEY);

            await hostGame.waitForTick(tickBeforeKeypress + 1);
            await expect(clientGame.endTurnButton).toBeEnabled({ timeout: 10_000 });
        } finally {
            if (defaultBinding !== null) {
                await resetActionBindingToDefault(hostWindow, END_TURN_ACTION_ID);
                await expect
                    .poll(() => readActionBinding(hostWindow, END_TURN_ACTION_ID), {
                        timeout: 10_000,
                    })
                    .toEqual(defaultBinding);
            }
            await clientApp?.close().catch(() => undefined);
        }
    });
});
