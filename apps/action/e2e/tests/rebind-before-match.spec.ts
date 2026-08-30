/**
 * rebind-before-match.spec.ts
 * §4.26 — input actions registered at app boot off the shell payload
 *
 * The side benefit that made the F87 hoist worth doing: a game's rebindable
 * actions reach Settings > Controls with NO MATCH EVER RUN.
 *
 * That is the whole claim, and it is easy to prove by accident: a suite that
 * opened Settings from inside a match would see the same rows and learn nothing,
 * because `GameShell` re-registers the table on the way in. This spec never
 * starts one — it boots at the menu, walks to Settings, and the rows are either
 * there or the registration did not happen at app boot.
 *
 * Then it changes one and follows it. A rebind that only repaints the row is
 * half a feature, so the rebound key is taken to the PRE-MATCH picker — the
 * other surface §4.26 exists for — and the old key is pressed there too, because
 * a binding that adds without removing reads as a working rebind from the new
 * key's side alone.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/electron.fixture';
import {
    ACTION_ALL_MOVE_ACTION_IDS,
    ACTION_DEFAULT_MOVE_BINDINGS,
    ACTION_MOVE_RIGHT_ACTION,
} from '@chimera-engine/action/input-action-ids.js';
import { ACTION_GAME_ID } from '@chimera-engine/action/simulation/constants.js';
import { NAV_TIMEOUT_MS, openSelectPage, SHELL_LOAD_TIMEOUT_MS } from '../helpers/enter-match';
import { ActionMainMenuPage } from '../pages/ActionMainMenuPage';
import { ActionMatchPage } from '../pages/ActionMatchPage';
import { ActionSettingsPage } from '../pages/ActionSettingsPage';

test.use({ actionPort: '7817' });

/** The key the movement action is moved onto — bound to nothing by default. */
const REBOUND_KEY = 'KeyL';

interface StoredBinding {
    readonly primary: string;
    readonly secondary: string | null;
    readonly modifiers: readonly string[];
}

type RendererGlobal = typeof globalThis & {
    readonly __chimera: {
        readonly settings: {
            get(gameId: string): Promise<{
                readonly controls?: {
                    readonly bindings?: Record<string, Partial<StoredBinding>>;
                };
            }>;
        };
    };
};

test.describe('Action controls before any match', () => {
    test('lists the game’s movement actions, and a rebind reaches the pre-match picker', async ({
        mainWindow,
    }) => {
        test.slow();

        const menu = new ActionMainMenuPage(mainWindow);
        const settings = new ActionSettingsPage(mainWindow);

        await menu.waitForGameMenu(SHELL_LOAD_TIMEOUT_MS);
        // Nothing has been played. If a match were needed to register the table,
        // every assertion below would fail on an empty Controls tab.
        await expect(new ActionMatchPage(mainWindow).canvas).toHaveCount(0);

        await menu.settingsButton.click();
        await expect(mainWindow).toHaveURL(/\/settings\/?\?gameId=action$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await settings.openControlsTab();

        // ── 1. Both seats' clusters are listed ───────────────────────────────
        // The whole declared table, taken from the app's own list rather than
        // re-typed here: an id added to the game and forgotten by the shell
        // payload would show up as a missing row.
        await expect(settings.bindingRow(ACTION_MOVE_RIGHT_ACTION)).toBeVisible({
            timeout: NAV_TIMEOUT_MS,
        });
        const listed = await settings.listedActionIds();
        for (const actionId of ACTION_ALL_MOVE_ACTION_IDS) {
            expect(listed, `Controls did not list ${actionId}`).toContain(actionId);
        }

        // …at the defaults the app's settings schema merged in, so the rebind
        // below is a change from a known state rather than from whatever was
        // there.
        await expect(settings.bindingValue(ACTION_MOVE_RIGHT_ACTION)).toHaveText(
            ACTION_DEFAULT_MOVE_BINDINGS[ACTION_MOVE_RIGHT_ACTION].primary,
        );

        // ── 2. Rebind, and let it settle in the persisted settings ───────────
        await settings.rebind(ACTION_MOVE_RIGHT_ACTION, REBOUND_KEY);
        await expect(settings.bindingValue(ACTION_MOVE_RIGHT_ACTION)).toHaveText(REBOUND_KEY, {
            timeout: NAV_TIMEOUT_MS,
        });
        // The row is a render; this is the write. A rebind the settings store
        // never persisted would repaint and be gone on the next read.
        await expect
            .poll(() => readStoredBinding(mainWindow, ACTION_MOVE_RIGHT_ACTION), {
                timeout: NAV_TIMEOUT_MS,
            })
            .toEqual({ primary: REBOUND_KEY, secondary: null, modifiers: [] });

        // ── 3. It reaches the picker, which no match has preceded ────────────
        await settings.close();
        await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=action$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        const select = await openSelectPage(mainWindow);
        await expect(select.hostPick).toHaveText(/cube$/, { timeout: NAV_TIMEOUT_MS });

        await mainWindow.keyboard.press(REBOUND_KEY);
        await expect(select.hostPick).toHaveText(/sphere$/, { timeout: NAV_TIMEOUT_MS });

        // ── 4. And the OLD key no longer does ────────────────────────────────
        // Read at the END of the pair, not between the two presses. The row is
        // `cube · sphere · cone` and stepping WRAPS, so if ArrowRight had still
        // stepped, this pair would have walked sphere → cone → cube and the
        // assertion below would read `cube`. An assertion placed straight after
        // the ArrowRight press would prove nothing either way: `sphere` already
        // holds, so a web-first check returns on its first poll — before any
        // re-render that press could have caused.
        await mainWindow.keyboard.press('ArrowRight');
        await mainWindow.keyboard.press(REBOUND_KEY);
        await expect(select.hostPick).toHaveText(/cone$/, { timeout: NAV_TIMEOUT_MS });
        // …and the second press is what makes the first one's silence readable:
        // the picker is still listening, so it is the BINDING that moved rather
        // than the page that went inert.
    });
});

/** The binding as the settings store actually holds it for this game. */
async function readStoredBinding(page: Page, actionId: string): Promise<StoredBinding | null> {
    return page.evaluate(
        async ({ gameId, inputActionId }) => {
            const settings = await (globalThis as RendererGlobal).__chimera.settings.get(gameId);
            const binding = settings.controls?.bindings?.[inputActionId];
            if (typeof binding?.primary !== 'string') {
                return null;
            }
            return {
                primary: binding.primary,
                secondary: typeof binding.secondary === 'string' ? binding.secondary : null,
                modifiers: Array.isArray(binding.modifiers) ? binding.modifiers : [],
            };
        },
        { gameId: ACTION_GAME_ID, inputActionId: actionId },
    );
}
