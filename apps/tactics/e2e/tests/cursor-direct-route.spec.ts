/**
 * Hardware-cursor E2E coverage for the no-declaration path (F69 #850).
 *
 * Boots a bare route directly (`initialRoute: '/settings'`, no gameId, no
 * direct-game role) so no game shell ever registers and the cursor injector
 * strictly no-ops. This differs from the no-gameId main-menu control in
 * cursor-shell.spec.ts: the engine-default menu still runs the shell chrome,
 * while a direct-route boot skips game shell registration entirely. Expected
 * result: base tokens only — a plain system cursor with no `url(` anywhere.
 */

import type { ElectronApplication, Locator, Page } from '@playwright/test';
import {
    expect,
    launchE2eElectronApplication,
    test as electronTest,
} from '../fixtures/electron.fixture';
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
        readonly body: unknown;
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

const CURSOR_ROLES = ['default', 'pointer', 'disabled'] as const;
type CursorRole = (typeof CURSOR_ROLES)[number];

/**
 * Dedicated port for this spec; does not collide with base (7778), lobby
 * (7779), or the other dedicated-port specs (7781, 7785–7789).
 */
const DIRECT_ROUTE_CURSOR_PORT = '7782';

const PAGE_SETTLE_TIMEOUT_MS = 15_000;

function inlineToken(page: Page, role: CursorRole): Promise<string> {
    return page.evaluate((r) => {
        const browser = globalThis as unknown as BrowserGlobalAccess;
        return browser.document.documentElement.style.getPropertyValue(`--ch-cursor-${r}`);
    }, role);
}

function computedBodyCursor(page: Page): Promise<string> {
    return page.evaluate(() => {
        const browser = globalThis as unknown as BrowserGlobalAccess;
        return browser.getComputedStyle(browser.document.body).cursor;
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

// --- Fixture -----------------------------------------------------------------

interface DirectRouteCursorFixtures {
    readonly directRouteApp: ElectronApplication;
    readonly directRouteWindow: Page;
}

const test = electronTest.extend<DirectRouteCursorFixtures>({
    // eslint-disable-next-line no-empty-pattern
    directRouteApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: DIRECT_ROUTE_CURSOR_PORT,
            initialRoute: '/settings',
        });
        try {
            await use(app);
        } finally {
            await app.close().catch(() => undefined);
        }
    },

    directRouteWindow: async ({ directRouteApp }, use) => {
        const window = await directRouteApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

// --- Spec --------------------------------------------------------------------

test.describe('Hardware cursor without a game declaration', () => {
    test('direct-route boot keeps the plain system cursor', async ({ directRouteWindow }) => {
        const settings = new SettingsPage(directRouteWindow);

        // Settle first: the injector (if a game shell had registered) runs
        // during boot, so asserting before the page is interactive would pass
        // vacuously against a not-yet-booted document.
        await expect(settings.closeButton).toBeVisible({ timeout: PAGE_SETTLE_TIMEOUT_MS });

        // No game shell registration ⇒ the injector never ran: no inline
        // overrides, base tokens only.
        for (const role of CURSOR_ROLES) {
            expect(await inlineToken(directRouteWindow, role)).toBe('');
        }

        // Plain system cursor throughout — exact keywords, no `url(`.
        expect(await computedBodyCursor(directRouteWindow)).toBe('auto');
        expect(await computedElementCursor(settings.closeButton)).toBe('pointer');
    });
});
