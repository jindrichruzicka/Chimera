/**
 * F38 — theme.spec.ts
 * §13.x Core E2E Test Specifications
 *
 * Verifies the theme system:
 *   - Default palette is applied to buttons on shell pages (main-menu)
 *   - Game-controlled theme override via LobbyConfig.themeId plumbing works
 *     without breaking the lobby page
 *
 * Invariant #3: Renderer must not import from simulation/, electron/main, or
 * networking/ directly.
 */
import { test, expect } from '../fixtures/electron.fixture';
import { MainMenuPage } from '../pages/MainMenuPage';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from '../../electron/main/renderer-url';

const LOBBY_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/lobby/`;

test.describe('Theme system', () => {
    test('default palette: main-menu buttons carry neutral engine-default theme styles', async ({
        mainWindow,
    }) => {
        const mainMenu = new MainMenuPage(mainWindow);
        await mainMenu.goto();

        const buttonExpectations = [
            {
                button: mainMenu.playButton,
                variant: 'primary',
                token: 'var(--ch-color-action-primary)',
            },
            {
                button: mainMenu.settingsButton,
                variant: 'secondary',
                token: 'var(--ch-color-action-secondary)',
            },
            {
                button: mainMenu.quitButton,
                variant: 'danger',
                token: 'var(--ch-color-action-danger)',
            },
        ] as const;

        for (const { button, variant, token } of buttonExpectations) {
            await expect(button).toBeVisible();
            await expect(button).toHaveAttribute('data-ch-button-variant', variant);

            const inlineStyle = (await button.getAttribute('style')) ?? '';
            expect(inlineStyle).toContain(token);
        }
    });

    test('game override: lobby page renders correctly with explicit themeId query param', async ({
        mainWindow,
    }) => {
        // Navigate to lobby with ?themeId=engine-default to exercise the full
        // LobbyConfig.themeId → useThemeOverride → ThemeProvider plumbing.
        await mainWindow.goto(`${LOBBY_URL}?themeId=engine-default`);

        const hostButton = mainWindow.getByTestId('host-lobby');
        await expect(hostButton).toBeVisible();

        // The override theme (engine-default) is applied through the nested ThemeProvider:
        // Button component still renders with the correct variant attribute.
        await expect(hostButton).toHaveAttribute('data-ch-button-variant', 'primary');

        // The registered engine-default theme's primary button style is active
        const inlineStyle = (await hostButton.getAttribute('style')) ?? '';
        expect(inlineStyle).toContain('var(--ch-color-action-primary)');
    });
});
