import { test, expect } from '../fixtures/electron.fixture';
import type { RendererConsoleEntry } from '../fixtures/electron.fixture';

const CHIMERA_STATUS_LOG = '[chimera] preload bridge live';

function formatConsoleEntries(entries: readonly RendererConsoleEntry[]): readonly string[] {
    return entries.map((entry) => `${entry.source}:${entry.level}: ${entry.text}`);
}

function isErrorEntry(entry: RendererConsoleEntry): boolean {
    return entry.source === 'pageerror' || entry.level === 'error';
}

/**
 * F30 boot-smoke: verifies the main window opens and the preload bridge is active.
 * Invariant 5: window.__chimera is exposed only through preload/api.ts.
 */
test('boot-smoke: main window opens and window.__chimera is defined', async ({ mainWindow }) => {
    const hasChimera = await mainWindow.evaluate(() => '__chimera' in globalThis);
    expect(hasChimera).toBe(true);
});

test('boot-smoke: main menu logo loads from the static export', async ({ mainWindow }) => {
    const logo = mainWindow.getByAltText('Chimera');

    await expect(logo).toBeVisible();
    await expect(logo).toHaveJSProperty('complete', true);
    await expect(logo).not.toHaveJSProperty('naturalWidth', 0);
});

test('boot-smoke: logo is preloaded from the exported head so it paints without tearing', async ({
    mainWindow,
}) => {
    // page.tsx marks the logo `priority`; the static export must therefore carry
    // a <link rel="preload" as="image"> in <head> so the fetch starts before
    // first paint instead of the PNG streaming in progressively.
    const preload = mainWindow.locator(
        'head link[rel="preload"][as="image"][href*="chimera-logo-compact"]',
    );
    await expect(preload).toHaveCount(1);

    // And the rendered img must not opt back into lazy loading.
    const logo = mainWindow.getByAltText('Chimera');
    await expect(logo).not.toHaveAttribute('loading', 'lazy');

    // The decode gate (opacity 0 until img.decode() settles) must actually
    // release — a gate that never reveals would pass toBeVisible (Playwright
    // ignores opacity) while shipping a blank boot screen.
    await expect(logo).toHaveCSS('opacity', '1');
});

test('boot-smoke: renderer logs Chimera status without console errors', async ({
    mainWindow,
    rendererConsole,
}) => {
    await expect(mainWindow.getByTestId('boot-smoke')).toBeVisible();

    await expect
        .poll(
            () =>
                rendererConsole.some(
                    (entry) => entry.level === 'log' && entry.text.includes(CHIMERA_STATUS_LOG),
                ),
            { timeout: 10_000 },
        )
        .toBe(true);

    expect(formatConsoleEntries(rendererConsole.filter(isErrorEntry))).toEqual([]);
});
