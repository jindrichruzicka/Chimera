/**
 * Hardware-cursor E2E coverage over the shell (F69 #848).
 *
 * Verifies the game-declared cursor textures land as `--ch-cursor-*` inline
 * overrides on the document root (Invariant #85), resolve over the
 * game-asset protocol (Invariant #97, no `renderer/public` copies), reach
 * the token consumers (root default, button pointer/disabled), and persist
 * across shell navigation. The rendered OS cursor itself is not
 * screenshot-able; these probes cover the specified tokens, the computed
 * styles, and the served texture bytes.
 *
 * Note the quoting asymmetry: the injector writes an UNQUOTED `url(...)`
 * (exact-matched on the inline property), while computed styles re-serialize
 * the url quoted — computed assertions therefore substring-match the path.
 */

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures/electron.fixture';
import { MainMenuPage } from '../pages/MainMenuPage';
import { SavesPage } from '../pages/SavesPage';
import { SettingsPage } from '../pages/SettingsPage';

// The e2e tsconfig carries no DOM lib (suite convention): in-page access
// goes through narrow structural views of the browser globals.
interface BrowserInlineStyleAccess {
    getPropertyValue(name: string): string;
}

interface BrowserCursorStyleAccess {
    readonly cursor: string;
}

interface BrowserGlobalAccess {
    readonly document: {
        readonly documentElement: { readonly style: BrowserInlineStyleAccess };
    };
    getComputedStyle(element: unknown): BrowserCursorStyleAccess;
}

interface BrowserElementWithDocument {
    readonly ownerDocument: {
        readonly defaultView: {
            getComputedStyle(element: unknown): BrowserCursorStyleAccess;
        } | null;
    };
}

interface BrowserDecodableImage {
    src: string;
    readonly naturalWidth: number;
    readonly naturalHeight: number;
    decode(): Promise<void>;
}

interface BrowserImageGlobal {
    readonly Image: new () => BrowserDecodableImage;
}

const CURSOR_ROLES = ['default', 'pointer', 'disabled'] as const;
type CursorRole = (typeof CURSOR_ROLES)[number];

/** Fallback keyword per role — mirrors GAME_CURSOR_FALLBACKS in the injector. */
const ROLE_FALLBACKS: Record<CursorRole, string> = {
    default: 'auto',
    pointer: 'pointer',
    disabled: 'not-allowed',
};

function cursorUrl(role: CursorRole): string {
    return `chimera://renderer/game-assets/tactics/cursors/${role}.png`;
}

/** The exact inline token value injected for tactics (hotspots omitted ⇒ 0 0). */
function expectedInlineToken(role: CursorRole): string {
    return `url(${cursorUrl(role)}) 0 0, ${ROLE_FALLBACKS[role]}`;
}

function inlineToken(page: Page, role: CursorRole): Promise<string> {
    return page.evaluate((r) => {
        const browser = globalThis as unknown as BrowserGlobalAccess;
        return browser.document.documentElement.style.getPropertyValue(`--ch-cursor-${r}`);
    }, role);
}

function computedRootCursor(page: Page): Promise<string> {
    return page.evaluate(() => {
        const browser = globalThis as unknown as BrowserGlobalAccess;
        return browser.getComputedStyle(browser.document.documentElement).cursor;
    });
}

function computedElementCursor(locator: Locator): Promise<string> {
    return locator.evaluate((element) => {
        const browserElement = element as unknown as BrowserElementWithDocument;
        const view = browserElement.ownerDocument.defaultView;
        if (view === null) {
            throw new Error('Element document does not have a defaultView');
        }
        return view.getComputedStyle(element).cursor;
    });
}

/** Injection awaits texture warm-up, so token reads must poll (CI is slow). */
async function expectInlineTokensInjected(page: Page): Promise<void> {
    for (const role of CURSOR_ROLES) {
        await expect
            .poll(() => inlineToken(page, role), { timeout: 15_000 })
            .toBe(expectedInlineToken(role));
    }
}

test.describe('Hardware cursor over the shell', () => {
    test('tactics main menu injects all three cursor roles and consumers resolve them', async ({
        mainWindow,
    }) => {
        const menu = new MainMenuPage(mainWindow);
        await menu.goto({ gameId: 'tactics' });

        await expectInlineTokensInjected(mainWindow);

        await expect
            .poll(() => computedRootCursor(mainWindow))
            .toContain('/game-assets/tactics/cursors/default.png');

        // Enabled buttons consume --ch-cursor-pointer …
        await expect
            .poll(() => computedElementCursor(menu.playButton))
            .toContain('/game-assets/tactics/cursors/pointer.png');

        // … and disabled buttons --ch-cursor-disabled (fresh profile ⇒ the
        // game-contributed Replays entry has no replays and renders disabled).
        await expect(menu.replaysButton).toBeDisabled();
        await expect
            .poll(() => computedElementCursor(menu.replaysButton))
            .toContain('/game-assets/tactics/cursors/disabled.png');
    });

    test('cursor textures decode over the game-asset protocol at 32x32', async ({ mainWindow }) => {
        const menu = new MainMenuPage(mainWindow);
        await menu.goto({ gameId: 'tactics' });
        await expectInlineTokensInjected(mainWindow);

        // Computed `cursor` reports the specified url even when the texture
        // 404s — decoding the texture in-page is the proof it actually serves.
        for (const role of CURSOR_ROLES) {
            const probe = await mainWindow.evaluate(async (url) => {
                const browser = globalThis as unknown as BrowserImageGlobal;
                const image = new browser.Image();
                image.src = url;
                await image.decode();
                return { width: image.naturalWidth, height: image.naturalHeight };
            }, cursorUrl(role));

            expect(probe, `cursor texture ${role}.png`).toEqual({ width: 32, height: 32 });
        }
    });

    test('cursor overrides persist across settings and saves navigation', async ({
        mainWindow,
    }) => {
        const menu = new MainMenuPage(mainWindow);
        await menu.goto({ gameId: 'tactics' });
        await expectInlineTokensInjected(mainWindow);

        await menu.clickButtonByLabel('Settings');
        await expect(mainWindow).toHaveURL(/\/settings\/?\?gameId=tactics$/);
        const settings = new SettingsPage(mainWindow);
        await expect(settings.closeButton).toBeVisible();
        await expectInlineTokensInjected(mainWindow);
        await expect
            .poll(() => computedElementCursor(settings.closeButton))
            .toContain('/game-assets/tactics/cursors/pointer.png');

        await settings.close();
        await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=tactics$/);

        await menu.loadGameButton.click();
        await expect(mainWindow).toHaveURL(/\/saves\/?\?gameId=tactics$/);
        const saves = new SavesPage(mainWindow);
        await expect(saves.pageRoot).toBeVisible();
        await expectInlineTokensInjected(mainWindow);
    });

    test('engine default menu (no game) injects no cursor overrides', async ({ mainWindow }) => {
        const menu = new MainMenuPage(mainWindow);
        await menu.goto();
        await expect(menu.menu).toBeVisible();

        for (const role of CURSOR_ROLES) {
            expect(await inlineToken(mainWindow, role)).toBe('');
        }
        expect(await computedRootCursor(mainWindow)).not.toContain('game-assets');
    });
});
