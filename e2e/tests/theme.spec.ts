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
import type { Locator } from '@playwright/test';
import { MainMenuPage } from '../pages/MainMenuPage';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from '../../electron/main/renderer-url';

const LOBBY_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/lobby/`;

interface BrowserStyleDeclaration {
    readonly backgroundColor: string;
    getPropertyValue(propertyName: string): string;
}

interface BrowserWindowAccess {
    getComputedStyle(element: unknown): BrowserStyleDeclaration;
}

interface BrowserProbeElement {
    readonly style: { backgroundColor: string };
    remove(): void;
}

interface BrowserDocumentAccess {
    readonly defaultView: BrowserWindowAccess | null;
    readonly documentElement: unknown;
    readonly body: {
        appendChild(element: BrowserProbeElement): void;
    };
    createElement(tagName: 'div'): BrowserProbeElement;
}

interface BrowserElementWithDocument {
    readonly ownerDocument: BrowserDocumentAccess;
}

async function expectButtonBackgroundToMatchToken(
    button: Locator,
    tokenName: `--ch-${string}`,
): Promise<void> {
    const colors = await button.evaluate((element, expectedTokenName) => {
        const browserElement = element as unknown as BrowserElementWithDocument;
        const ownerDocument = browserElement.ownerDocument;
        const view = ownerDocument.defaultView;
        if (!view) throw new Error('Button document does not have a defaultView');

        const tokenValue = view
            .getComputedStyle(ownerDocument.documentElement)
            .getPropertyValue(expectedTokenName)
            .trim();
        const probe = ownerDocument.createElement('div');
        probe.style.backgroundColor = tokenValue;
        ownerDocument.body.appendChild(probe);

        const expectedBackgroundColor = view.getComputedStyle(probe).backgroundColor;
        const actualBackgroundColor = view.getComputedStyle(element).backgroundColor;
        probe.remove();

        return { actualBackgroundColor, expectedBackgroundColor };
    }, tokenName);

    expect(colors.actualBackgroundColor).toBe(colors.expectedBackgroundColor);
}

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
                token: '--ch-color-accent',
            },
            {
                button: mainMenu.settingsButton,
                variant: 'secondary',
                token: '--ch-color-surface-raised',
            },
            {
                button: mainMenu.quitButton,
                variant: 'danger',
                token: '--ch-color-error',
            },
        ] as const;

        for (const { button, variant, token } of buttonExpectations) {
            await expect(button).toBeVisible();
            await expect(button).toHaveAttribute('data-ch-button-variant', variant);
            await expectButtonBackgroundToMatchToken(button, token);
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

        // The registered engine-default theme's primary button style is active.
        await expectButtonBackgroundToMatchToken(hostButton, '--ch-color-accent');
    });
});
