/**
 * Hardware-cursor E2E coverage for the in-match scene (F69 #848).
 *
 * The engine sets `cursor` once on `:root` (`--ch-cursor-default`), and the
 * R3F canvas deliberately carries no cursor rule of its own — it inherits
 * the game-declared texture. This spec locks that inheritance: the tactics
 * default cursor texture must be the computed cursor of the in-match canvas,
 * not just of shell chrome.
 */
import { test, expect } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

// The e2e tsconfig carries no DOM lib (suite convention): in-page access
// goes through narrow structural views of the browser globals.
interface BrowserInlineStyleAccess {
    getPropertyValue(name: string): string;
}

interface BrowserGlobalAccess {
    readonly document: {
        readonly documentElement: { readonly style: BrowserInlineStyleAccess };
    };
}

interface BrowserElementWithDocument {
    readonly ownerDocument: {
        readonly defaultView: {
            getComputedStyle(element: unknown): { readonly cursor: string };
        } | null;
    };
}

test.use({ passAndPlay: true });

test.describe('Hardware cursor in match', () => {
    test('R3F canvas inherits the tactics default cursor texture', async ({ hostWindow }) => {
        const game = new GamePage(hostWindow);
        await expect(game.canvas).toBeVisible({ timeout: 15_000 });

        // Injection awaits texture warm-up, so poll. The inline token is the
        // injector's exact unquoted form; computed styles re-quote the url,
        // hence the substring assertion on the canvas.
        await expect
            .poll(
                () =>
                    hostWindow.evaluate(() => {
                        const browser = globalThis as unknown as BrowserGlobalAccess;
                        return browser.document.documentElement.style.getPropertyValue(
                            '--ch-cursor-default',
                        );
                    }),
                { timeout: 15_000 },
            )
            .toBe('url(chimera://renderer/game-assets/tactics/cursors/default.png) 0 0, auto');

        await expect
            .poll(
                () =>
                    game.tacticsCanvas.evaluate((element) => {
                        const browserElement = element as unknown as BrowserElementWithDocument;
                        const view = browserElement.ownerDocument.defaultView;
                        if (view === null) {
                            throw new Error('Canvas document does not have a defaultView');
                        }
                        return view.getComputedStyle(element).cursor;
                    }),
                { timeout: 15_000 },
            )
            .toContain('/game-assets/tactics/cursors/default.png');
    });
});
