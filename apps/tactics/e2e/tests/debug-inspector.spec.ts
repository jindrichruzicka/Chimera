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
 *   - The window paints the dark bootstrap surface instead of default white
 *     (#701 regression — a white Inspector window means a failed load)
 *   - The page fits the window with no document-level scrollbar, and the
 *     Action Log / Projection scroll regions stretch to the bottom of the
 *     window instead of stopping at a fixed-height cap
 *   - Live ticks pushed from the running session reach the Performance
 *     panel without a manual refresh (`chimera:debug:push` →
 *     SUBSCRIBE_LIVE round-trip)
 *   - The Action Log surfaces new actions on Refresh and double-clicking a
 *     row drives the shared selection into the Snapshot tab
 *   - The Diff tab's Refresh re-fetches the tick list, so ticks recorded
 *     after the Inspector opened become selectable and diffable
 *   - Without CHIMERA_DEBUG=1 no toggle listener exists, so F9 is a true
 *     no-op (Invariant #27: no debug surface is registered outside debug mode)
 */

import { test, expect } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

interface InspectorScrollMetricsElement {
    readonly clientHeight: number;
    readonly scrollHeight: number;
}

/** DOM globals inside `evaluate` callbacks — the e2e tsconfig has no DOM lib. */
interface InspectorWindowGlobalAccess {
    readonly document: {
        readonly documentElement: InspectorScrollMetricsElement;
    };
    readonly innerHeight: number;
}

interface InspectorRegionElementAccess {
    getBoundingClientRect(): { readonly top: number; readonly bottom: number };
}

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
        await expect(inspectorWindow.getByRole('tab', { name: 'Action Log' })).toBeVisible();

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

    test('window paints the dark bootstrap surface, never default white', async ({
        hostApp,
        hostWindow,
    }) => {
        // #701 regression: without an explicit backgroundColor the window
        // paints default white while loading — and stays white when the
        // renderer build lacks the /debug route.
        const [inspectorWindow] = await Promise.all([
            hostApp.waitForEvent('window'),
            hostWindow.keyboard.press('F9'),
        ]);
        await inspectorWindow.waitForLoadState('domcontentloaded');
        await expect(inspectorWindow.getByTestId('debug-inspector-page')).toBeVisible();

        const backgroundColor = await hostApp.evaluate(({ BrowserWindow }) => {
            const inspector = BrowserWindow.getAllWindows().find((candidate) =>
                candidate.webContents.getURL().includes('/debug/'),
            );
            return inspector?.getBackgroundColor() ?? null;
        });
        expect(backgroundColor?.toLowerCase()).toBe('#111113');
    });

    test('page fits the window without a document scrollbar and panels stretch to its bottom', async ({
        hostApp,
        hostWindow,
    }) => {
        const [inspectorWindow] = await Promise.all([
            hostApp.waitForEvent('window'),
            hostWindow.keyboard.press('F9'),
        ]);
        await inspectorWindow.waitForLoadState('domcontentloaded');
        await expect(inspectorWindow.getByTestId('action-row-0')).toBeVisible();

        // The window itself never scrolls — each panel owns its own scrolling.
        const documentOverflow = await inspectorWindow.evaluate(() => {
            const browser = globalThis as unknown as InspectorWindowGlobalAccess;
            const root = browser.document.documentElement;
            return root.scrollHeight - root.clientHeight;
        });
        expect(documentOverflow).toBe(0);

        const regionRect = async (
            regionName: string,
        ): Promise<{ readonly top: number; readonly bottom: number }> => {
            const region = inspectorWindow.getByRole('region', { name: regionName });
            await expect(region).toBeVisible();
            return region.evaluate((element) => {
                const rect = (
                    element as unknown as InspectorRegionElementAccess
                ).getBoundingClientRect();
                return { top: rect.top, bottom: rect.bottom };
            });
        };

        // A panel's scroll region must reach the bottom of the viewport
        // instead of stopping at a fixed-height cap around mid-page.
        const expectStretchesToBottom = async (regionName: string): Promise<void> => {
            const { bottom } = await regionRect(regionName);
            const viewportHeight = await inspectorWindow.evaluate(
                () => (globalThis as unknown as InspectorWindowGlobalAccess).innerHeight,
            );
            expect(bottom, `"${regionName}" should stretch to the window bottom`).toBeGreaterThan(
                viewportHeight * 0.9,
            );
        };

        await expectStretchesToBottom('Action log entries');

        await inspectorWindow.getByRole('tab', { name: 'Snapshot' }).click();
        await expectStretchesToBottom('Full snapshot tree');
        await expectStretchesToBottom('Projection tree');

        // The legend (full-snapshot column) and the player select (projection
        // column) share one grid row, so the two snapshot trees cover the
        // same vertical span.
        const fullRect = await regionRect('Full snapshot tree');
        const projectionRect = await regionRect('Projection tree');
        expect(Math.abs(fullRect.top - projectionRect.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(fullRect.bottom - projectionRect.bottom)).toBeLessThanOrEqual(1);
    });

    test('live session ticks stream into the Performance panel without a manual refresh', async ({
        hostApp,
        hostWindow,
    }) => {
        const match = new GamePage(hostWindow);
        const [inspectorWindow] = await Promise.all([
            hostApp.waitForEvent('window'),
            hostWindow.keyboard.press('F9'),
        ]);
        await inspectorWindow.waitForLoadState('domcontentloaded');

        await inspectorWindow.getByRole('tab', { name: 'Performance' }).click();
        await expect(inspectorWindow.getByTestId('stat-actions')).toBeVisible();
        const actionsBefore = Number(
            await inspectorWindow.getByTestId('stat-actions').textContent(),
        );

        // A live host action must bump the aggregates with no user input
        // (ring buffer onRecord → chimera:debug:push → SUBSCRIBE_LIVE →
        // onLiveTick → coalesced getPerfStats refetch).
        const tickBefore = await match.currentTick();
        await match.endTurnButton.click();
        await match.waitForTick(tickBefore + 1);
        await expect
            .poll(async () =>
                Number(await inspectorWindow.getByTestId('stat-actions').textContent()),
            )
            .toBeGreaterThan(actionsBefore);
    });

    test('Diff tab Refresh makes ticks recorded after opening selectable and diffable', async ({
        hostApp,
        hostWindow,
    }) => {
        const match = new GamePage(hostWindow);
        const [inspectorWindow] = await Promise.all([
            hostApp.waitForEvent('window'),
            hostWindow.keyboard.press('F9'),
        ]);
        await inspectorWindow.waitForLoadState('domcontentloaded');

        await inspectorWindow.getByRole('tab', { name: 'Diff' }).click();
        const diffPanel = inspectorWindow.getByTestId('diff-panel');
        await expect(diffPanel.getByRole('button', { name: 'Refresh' })).toBeVisible();

        // Record a fresh tick after the panel's initial tick-list fetch.
        const tickBefore = await match.currentTick();
        await match.endTurnButton.click();
        await match.waitForTick(tickBefore + 1);

        // Refresh pulls the new tick into the pickers; selecting it as the
        // diff target resolves a non-empty diff (the turn state advanced).
        await diffPanel.getByRole('button', { name: 'Refresh' }).click();
        await diffPanel.getByLabel('To tick').selectOption(String(tickBefore + 1));
        await expect(diffPanel.getByText(/\d+ changed/)).toBeVisible();
    });

    test('Action Log refresh reveals new actions and double-click jumps to the Snapshot tab', async ({
        hostApp,
        hostWindow,
    }) => {
        const match = new GamePage(hostWindow);
        const [inspectorWindow] = await Promise.all([
            hostApp.waitForEvent('window'),
            hostWindow.keyboard.press('F9'),
        ]);
        await inspectorWindow.waitForLoadState('domcontentloaded');

        // The Action Log is the default tab and backfills the boot actions
        // (engine:start_game at tick 0).
        await expect(inspectorWindow.getByTestId('action-row-0')).toBeVisible();

        const tickBefore = await match.currentTick();
        await match.endTurnButton.click();
        await match.waitForTick(tickBefore + 1);
        await inspectorWindow.getByRole('button', { name: 'Refresh' }).click();
        // The log records pre-action ticks: the end-turn action applied AT
        // tickBefore (producing tickBefore + 1) is the new row.
        const newRow = inspectorWindow.getByTestId(`action-row-${tickBefore}`);
        await expect(newRow).toBeVisible();

        // Double-click drives the shared selection: the Snapshot tab opens
        // showing the full debug-truth snapshot and per-player projection.
        await newRow.dblclick();
        await expect(inspectorWindow.getByTestId('snapshot-panel')).toBeVisible();
        await expect(inspectorWindow.getByText(/Full snapshot \(debug truth\)/)).toBeVisible();
        await expect(inspectorWindow.getByTestId('json-tree').first()).toBeVisible();
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
