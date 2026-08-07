import { test, expect } from '../fixtures/electron.fixture';

/**
 * Boot-smoke: the one e2e spec a freshly scaffolded game ships. It proves the
 * generated consumer composes the @chimera-engine/* packages into a runnable Electron app:
 * the main window opens and the preload bridge exposes window.__chimera, which is exposed
 * only through preload/api.ts. The assertion targets an engine-shell seam that exists in a
 * blank game — no game-specific logic. Add game-specific e2e specs alongside this one.
 */
test('boot-smoke: main window opens and window.__chimera is defined', async ({ mainWindow }) => {
    const hasChimera = await mainWindow.evaluate(() => '__chimera' in globalThis);
    expect(hasChimera).toBe(true);
});
