/**
 * F47 — debug-inspector.spec.ts
 * §4.12 Runtime Debug Layer
 *
 * Verifies Debug Inspector window toggle behaviour (F9 →
 * `engine:toggle-debug-inspector` → `system.toggleDebugInspector()` IPC →
 * `electron/main/debug-bridge.ts`):
 *   - Inspector window is closed by default — the bridge creates NO window
 *     at startup (ratified in F47 T10, #699)
 *   - First F9 opens the Inspector window with a live debug bridge
 *   - Second F9 closes it
 *   - Third F9 reopens a fresh window (the closed-handler race guard must
 *     not leave stale state behind)
 *   - Without CHIMERA_DEBUG=1 no toggle listener exists, so F9 is a true
 *     no-op (Invariant #27: the debug graph stays out of production)
 */

import { test, expect } from '../fixtures/direct-game.fixture';

// Single-window pass-and-play session; no client process is needed.
test.use({ passAndPlay: true });

test.describe('Debug Inspector (debug mode)', () => {
    test.use({ debugMode: true });

    test('window is closed by default, opened by F9, closed and reopened by further F9 presses', async ({
        hostApp,
        hostWindow,
    }) => {
        // Closed by default — only the game window exists after boot.
        expect(hostApp.windows()).toHaveLength(1);

        // First F9 opens the Inspector window.
        const [inspectorWindow] = await Promise.all([
            hostApp.waitForEvent('window'),
            hostWindow.keyboard.press('F9'),
        ]);
        await inspectorWindow.waitForLoadState('domcontentloaded');
        await expect(inspectorWindow.getByTestId('debug-inspector-page')).toBeVisible();

        // The debug-api preload bridge is live: the panel tabs render rather
        // than the "Inspector bridge unavailable" fallback.
        await expect(inspectorWindow.getByRole('tab', { name: 'Timeline' })).toBeVisible();

        // Second F9 closes the window again.
        await Promise.all([inspectorWindow.waitForEvent('close'), hostWindow.keyboard.press('F9')]);
        await expect.poll(() => hostApp.windows().length).toBe(1);

        // Third F9 reopens a fresh Inspector window.
        const [reopenedWindow] = await Promise.all([
            hostApp.waitForEvent('window'),
            hostWindow.keyboard.press('F9'),
        ]);
        await reopenedWindow.waitForLoadState('domcontentloaded');
        await expect(reopenedWindow.getByTestId('debug-inspector-page')).toBeVisible();
    });
});

test.describe('Debug Inspector (debug mode off)', () => {
    test('F9 is a no-op when CHIMERA_DEBUG is not set', async ({ hostApp, hostWindow }) => {
        expect(hostApp.windows()).toHaveLength(1);

        await hostWindow.keyboard.press('F9');

        // No toggle listener is registered without the debug bridge; give the
        // IPC round-trip ample time before asserting nothing opened.
        await hostWindow.waitForTimeout(1_000);
        expect(hostApp.windows()).toHaveLength(1);
    });
});
