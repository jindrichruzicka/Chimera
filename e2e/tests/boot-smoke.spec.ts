import { test, expect } from '../fixtures/electron.fixture';

/**
 * F30 boot-smoke: verifies the main window opens and the preload bridge is active.
 * Invariant 5: window.__chimera is exposed only through preload/api.ts.
 */
test('boot-smoke: main window opens and window.__chimera is defined', async ({ mainWindow }) => {
    const hasChimera = await mainWindow.evaluate(() => '__chimera' in globalThis);
    expect(hasChimera).toBe(true);
});
