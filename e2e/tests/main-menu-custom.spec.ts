/**
 * §4.37 main-menu-custom.spec.ts
 * Issue #622 — Add E2E spec for game-customized main menu (fallback + tactics override)
 * Part of: #615 F51 — Game-Customizable Main Menu
 *
 * Invariant #94: Engine shell pages must not import from any `games/*` path.
 * Customisation enters via rendererGameRegistry only.
 *
 * Invariant #5: window.__chimera is exposed only through preload/api.ts.
 */

import { test, expect } from '../fixtures/electron.fixture';
import { MainMenuPage } from '../pages/MainMenuPage';
import { SettingsPage } from '../pages/SettingsPage';

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('Game-customized main menu (§4.37 / #622)', () => {
    /**
     * Scenario 1 — Engine fallback:
     * When no lobby is active the main menu must show the engine-default
     * buttons: Play, Settings, Quit.
     */
    test('engine fallback — no active game shows Play, Settings, Quit', async ({ electronApp }) => {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');

        const menu = new MainMenuPage(window);
        await menu.goto();
        await menu.menu.waitFor({ state: 'visible' });

        const labels = await menu.getButtonLabels();
        expect(labels).toContain('Play');
        expect(labels).toContain('Settings');
        expect(labels).toContain('Quit');
        expect(labels).not.toContain('New Game');
        expect(labels).not.toContain('Load Game');
    });

    /**
     * Scenario 2 — Tactics custom menu:
     * When the main-menu URL declares gameId=tactics, the main menu must show
     * the game-specific buttons contributed by the tactics shell:
     * New Game, Load Game, Settings, Quit — each with matching accessible text.
     */
    test('tactics override — URL game context shows New Game, Load Game, Settings, Quit', async ({
        electronApp,
    }) => {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');

        const menu = new MainMenuPage(window);
        await menu.goto({ gameId: 'tactics' });

        // Wait for the URL-selected tactics shell to load and render.
        await expect.poll(() => menu.getButtonLabels(), { timeout: 15_000 }).toContain('New Game');

        const labels = await menu.getButtonLabels();
        expect(labels).toContain('New Game');
        expect(labels).toContain('Load Game');
        expect(labels).toContain('Settings');
        expect(labels).toContain('Quit');
        // Engine-default "Play" must never appear once the tactics shell is loaded.
        expect(labels).not.toContain('Play');

        // Each button must also be reachable by its accessible name so that
        // screen readers and POM helpers can target them reliably.
        for (const label of ['New Game', 'Load Game', 'Settings', 'Quit']) {
            await expect(window.getByRole('button', { name: label, exact: true })).toBeVisible();
        }
    });

    /**
     * Scenario 3 — Navigation action works:
     * Clicking "Settings" in the engine-fallback menu must navigate to /settings.
     */
    test('Settings button navigates to /settings', async ({ electronApp }) => {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');

        const menu = new MainMenuPage(window);
        await menu.goto();
        await menu.menu.waitFor({ state: 'visible' });

        await menu.clickButtonByLabel('Settings');

        await window.waitForURL('**/settings/**');
    });

    test('tactics Settings preserves game context and returns to tactics menu', async ({
        electronApp,
    }) => {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');

        const menu = new MainMenuPage(window);
        await menu.goto({ gameId: 'tactics' });
        await expect.poll(() => menu.getButtonLabels(), { timeout: 15_000 }).toContain('New Game');

        await menu.clickButtonByLabel('Settings');
        await expect(window).toHaveURL(/\/settings\/?\?gameId=tactics$/);

        const settingsPage = new SettingsPage(window);
        await expect(window.getByRole('tab', { name: 'AI', exact: true })).toBeVisible({
            timeout: 10_000,
        });

        await settingsPage.clickTab('AI');
        await expect(settingsPage.getControlByLabel('AI Thinking Delay')).toBeVisible();

        await settingsPage.close();
        await expect(window).toHaveURL(/\/main-menu\/?\?gameId=tactics$/);

        const labels = await menu.getButtonLabels();
        expect(labels).toContain('New Game');
        expect(labels).toContain('Settings');
        expect(labels).not.toContain('Play');
    });
});
