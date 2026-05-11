/**
 * F34 — save-load.spec.ts
 * §13.8 Core E2E Test Specifications · §4.11 Save/Load Persistence
 *
 * Part of #526. Implements issue #527.
 *
 * Verifies the full save → close → relaunch → load lifecycle:
 *   1. Launch a single-player (pass-and-play) match.
 *   2. Play exactly 3 turns via MatchPage actions to advance the simulation tick.
 *   3. Save via chimera:saves:save IPC; record tick pre-close.
 *   4. Close the Electron process.
 *   5. Relaunch using the captured process args + env (same userData dir).
 *   6. Load the saved slot via chimera:saves:load IPC.
 *   7. Assert getSimulationTick() post-relaunch equals the tick recorded pre-close.
 *
 * Invariants upheld:
 *   #23 — FileSaveRepository writes via .tmp rename; test observes only the
 *          complete, renamed save file (Invariant #23 is implicit — we call
 *          saves.save() and trust it resolves only after the atomic write).
 *   #24 — SessionRuntime.applyRestoredFile() is the only load entry point;
 *          test dispatches load via IPC (window.__chimera.saves.load), never
 *          calls internal APIs.
 *   #25 — engine:save/engine:load only accepted from host player; single-player
 *          pass-and-play fixture is always the host.
 *   #26 — pendingCommitments restored on load; the tick assertion implicitly
 *          validates the full end-to-end restore (Invariant #26 fails if
 *          commitments are dropped and the simulation diverges).
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or networking/.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { launchE2eElectronApplication, test as electronTest } from '../fixtures/electron.fixture';
import { getSimulationTick } from '../helpers/ipc-spy';
import { captureRelaunchConfig, relaunchElectronApplication } from '../helpers/relaunch';
import { MatchPage } from '../pages/MatchPage';

// ─── Renderer bridge types ────────────────────────────────────────────────────
// Derived from electron/preload/api-types.ts without importing from that module.

interface SaveSlotMetaResult {
    readonly slotId: string;
    readonly gameId: string;
    readonly tick: number;
    readonly savedAt: number;
    readonly label?: string;
}

interface RendererSavesBridge {
    save(request: {
        readonly gameId: string;
        readonly label?: string;
    }): Promise<SaveSlotMetaResult>;
    load(slotId: string): Promise<void>;
}

type RendererGlobal = typeof globalThis & {
    readonly __chimera: { readonly saves: RendererSavesBridge };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Trigger a save via the preload bridge and return the assigned slotId.
 * Uses gameId 'tactics' which is the active game in all E2E fixtures.
 */
async function saveCurrentState(page: Page): Promise<string> {
    const meta = await page.evaluate(() =>
        (globalThis as RendererGlobal).__chimera.saves.save({
            gameId: 'tactics',
            label: 'save-load-spec',
        }),
    );
    return meta.slotId;
}

/**
 * Trigger a load via the preload bridge. The main process will restore the
 * simulation from the save file and navigate the renderer to the match screen.
 */
async function loadSavedState(page: Page, slotId: string): Promise<void> {
    await page.evaluate(
        (id: string) => (globalThis as RendererGlobal).__chimera.saves.load(id),
        slotId,
    );
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

/** Dedicated port for this spec; does not collide with base (7778) or lobby (7779). */
const SAVE_LOAD_PORT = '7785';

interface SaveLoadFixtures {
    readonly saveLoadApp: ElectronApplication;
    readonly saveLoadWindow: Page;
}

const test = electronTest.extend<SaveLoadFixtures>({
    // eslint-disable-next-line no-empty-pattern
    saveLoadApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: SAVE_LOAD_PORT,
            directMatchRole: 'host',
            passAndPlay: true,
        });
        try {
            await use(app);
        } finally {
            // Suppress errors: the test intentionally closes the app mid-run
            // during the save → relaunch → load flow, so teardown may find
            // the process already gone.
            await app.close().catch(() => undefined);
        }
    },

    saveLoadWindow: async ({ saveLoadApp }, use) => {
        const window = await saveLoadApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe('Save / load', () => {
    test('tick is restored to pre-save value after relaunch + load', async ({
        saveLoadApp,
        saveLoadWindow,
    }) => {
        const match = new MatchPage(saveLoadWindow);

        // Wait for the match canvas — direct-match boot may need a moment.
        await expect(match.canvas).toBeVisible({ timeout: 30_000 });

        // Play exactly 3 turns via pass-and-play auto-handoff.
        // Each iteration: the active seat moves a unit and ends its turn; the
        // window then auto-transitions to the next seat (button: disabled → enabled).
        for (let turn = 0; turn < 3; turn++) {
            await expect(match.endTurnButton).toBeEnabled({ timeout: 30_000 });
            await match.moveOwnedUnit();
            await match.endTurnButton.click();
            // Wait for the handoff: the button goes disabled then re-enables.
            await expect(match.endTurnButton).toBeDisabled();
            await expect(match.endTurnButton).toBeEnabled({ timeout: 30_000 });
        }

        // Record tick before persisting.
        const tickBeforeSave = await getSimulationTick(saveLoadApp);
        expect(tickBeforeSave).toBeGreaterThan(0);

        // Persist via IPC — resolves only after the atomic .tmp rename (Invariant #23).
        const slotId = await saveCurrentState(saveLoadWindow);

        // Capture launch config (args include --user-data-dir so the relaunched
        // process finds the same saves directory).
        const relaunchConfig = await captureRelaunchConfig(saveLoadApp);

        // Close — fixture teardown will also call close() and suppress the error.
        await saveLoadApp.close();

        // Relaunch with the same userData dir; CHIMERA_E2E=1 is preserved in env.
        const relaunchedApp = await relaunchElectronApplication(relaunchConfig);
        try {
            const relaunchedWindow = await relaunchedApp.firstWindow();
            await relaunchedWindow.waitForLoadState('domcontentloaded');

            // Wait for the match session to become active before loading.
            // applyRestoredFile silently no-ops when activeSession === null;
            // the canvas becoming visible is the reliable signal that both
            // local seats are ready and auto-start has fired.
            await expect(new MatchPage(relaunchedWindow).canvas).toBeVisible({ timeout: 30_000 });

            // Load the saved slot — dispatches load via IPC (Invariant #24).
            await loadSavedState(relaunchedWindow, slotId);

            // Assert tick equality: SessionRuntime.restoreFromSave() must have
            // replaced the live GameSnapshot with the checkpoint and restored
            // pendingCommitments (Invariants #24, #26).
            await expect
                .poll(() => getSimulationTick(relaunchedApp), { timeout: 30_000 })
                .toBe(tickBeforeSave);
        } finally {
            await relaunchedApp.close();
        }
    });
});
