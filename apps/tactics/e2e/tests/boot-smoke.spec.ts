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
