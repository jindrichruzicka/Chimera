/**
 * F34 — crash-recovery.spec.ts
 * §13.8 Core E2E Test Specifications · §4.11 Save/Load Persistence
 *
 * Part of #526. Implements issue #528.
 *
 * Verifies the crash-recovery lifecycle:
 *   1. Launch a single-player (pass-and-play) match.
 *   2. Play several turns to advance the simulation tick.
 *   3. Trigger the crash autosave path through __e2eHooks.triggerCrashSave().
 *   4. Read the saved checkpoint tick via getLastSavedTick().
 *   5. Exit the Electron process without `before-quit` so `lastCleanExit.flag`
 *      is NOT written — simulates an unclean shutdown without SIGKILL.
 *   6. Relaunch with the same `--user-data-dir` so the saved data is available.
 *   7. Assert that the `crash-recovery-banner` is visible ("Resume" prompt shown).
 *   8. Wait for the match canvas to be visible before clicking Resume, so
 *      SessionRuntime.applyRestoredFile() has an active session to restore into.
 *   9. Click "Resume last session".
 *  10. Assert getSimulationTick() matches the saved checkpoint tick.
 *
 * Invariants upheld:
 *   #23 — FileSaveRepository writes via .tmp rename; the autosave slot we read
 *          is the complete, renamed file.
 *   #24 — SessionRuntime.applyRestoredFile() is the only restore entry point;
 *          the test triggers load via the preload bridge ("Resume last session"
 *          button), which calls window.__chimera.saves.load(slotId) → IPC →
 *          SessionRuntime.applyRestoredFile().
 *   #68 — Crash reporter runs autosave before crash dump; triggerCrashSave
 *          drives that autosave path without terminating the process.
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or
 * networking/. ElectronApplication, Page, and the Playwright test types are
 * the only external imports.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { launchE2eElectronApplication, test as electronTest } from '../fixtures/electron.fixture';
import { getLastSavedSlotId, getLastSavedTick, getSimulationTick } from '../helpers/ipc-spy';
import { captureRelaunchConfig, relaunchElectronApplication } from '../helpers/relaunch';
import { MatchPage } from '../pages/MatchPage';

// ─── Renderer bridge types ────────────────────────────────────────────────────
// Derived from electron/preload/api-types.ts without importing from that module.

interface CrashRecoveryStatusResult {
    readonly needsRecovery: boolean;
    readonly slotId: string | null;
}

interface RendererSavesBridge {
    checkCrashRecovery(): Promise<CrashRecoveryStatusResult>;
}

type RendererGlobal = typeof globalThis & {
    readonly __chimera: { readonly saves: RendererSavesBridge };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Trigger the crash-reporter autosave path from the main-process E2E hook.
 *
 * The hook is CHIMERA_E2E-gated and wired by the session runtime. It is a
 * void trigger, so this helper polls until the save metadata lands.
 */
async function triggerCrashSave(app: ElectronApplication): Promise<void> {
    await app.evaluate(() => {
        globalThis.__e2eHooks?.triggerCrashSave();
    });
    await expect.poll(() => getLastSavedTick(app), { timeout: 30_000 }).not.toBeNull();
}

/**
 * Exit the Electron main process without running Electron's before-quit
 * lifecycle. This leaves `lastCleanExit.flag` absent without using SIGKILL.
 */
async function exitWithoutCleanQuit(app: ElectronApplication): Promise<void> {
    const closeEvent = app.waitForEvent('close');
    await app.evaluate(() => {
        // Exit code 1 signals an abnormal exit. The crash-recovery detection
        // mechanism is flag-file-based (lastCleanExit.flag), not exit-code-based,
        // but using a non-zero code better represents an unclean shutdown.
        setImmediate(() => process.exit(1));
    });
    await closeEvent;
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

/** Dedicated port — does not collide with base (7778), lobby/direct-match (7779), or save-load (7785). */
const CRASH_RECOVERY_PORT = '7786';

interface CrashRecoveryFixtures {
    readonly crashApp: ElectronApplication;
    readonly crashWindow: Page;
}

const test = electronTest.extend<CrashRecoveryFixtures>({
    // eslint-disable-next-line no-empty-pattern
    crashApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: CRASH_RECOVERY_PORT,
            directMatchRole: 'host',
            passAndPlay: true,
        });
        try {
            await use(app);
        } finally {
            // Suppress errors: the test intentionally kills the app mid-run so
            // teardown may find the process already gone.
            await app.close().catch(() => undefined);
        }
    },

    crashWindow: async ({ crashApp }, use) => {
        const window = await crashApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe('Crash recovery', () => {
    test('tick is restored to crash-save value after unclean exit, relaunch, and Resume', async ({
        crashApp,
        crashWindow,
    }) => {
        const match = new MatchPage(crashWindow);

        // Wait for the match canvas — direct-match boot may need a moment.
        await expect(match.canvas).toBeVisible({ timeout: 30_000 });

        // Play 3 turns in pass-and-play mode so the crash save captures a
        // non-zero checkpoint tick.
        for (let turn = 0; turn < 3; turn++) {
            await expect(match.endTurnButton).toBeEnabled({ timeout: 30_000 });
            await match.moveOwnedUnit();
            await match.endTurnButton.click();
            // Wait for the handoff: button goes disabled then re-enables.
            await expect(match.endTurnButton).toBeDisabled();
            await expect(match.endTurnButton).toBeEnabled({ timeout: 30_000 });
        }

        // Drive the crash autosave path through the E2E hook rather than
        // depending on end_turn autosave timing or a hardcoded slot lookup.
        await triggerCrashSave(crashApp);
        const savedSlotId = await getLastSavedSlotId(crashApp);
        const savedTick = await getLastSavedTick(crashApp);
        expect(savedSlotId).toBe('tactics/autosave');
        expect(savedTick).not.toBeNull();
        if (savedTick === null) {
            throw new Error('crash save did not update CHIMERA_E2E last-save hooks');
        }
        expect(savedTick).toBeGreaterThan(0);

        // Capture the launch config (args carry --user-data-dir so the
        // relaunched process finds the same saves directory).
        const relaunchConfig = await captureRelaunchConfig(crashApp);

        // Exit without before-quit — no lastCleanExit.flag is written, which
        // makes the relaunch present the "Resume" prompt.
        await exitWithoutCleanQuit(crashApp);

        // Relaunch with the same userData dir; CHIMERA_E2E=1 preserved.
        const relaunchedApp = await relaunchElectronApplication(relaunchConfig);
        try {
            const relaunchedWindow = await relaunchedApp.firstWindow();
            await relaunchedWindow.waitForLoadState('domcontentloaded');

            // The CrashRecoveryBanner is mounted in the root layout and calls
            // checkCrashRecovery() once on mount. Assert the banner is visible
            // before interacting with it.
            await expect(relaunchedWindow.getByTestId('crash-recovery-banner')).toBeVisible({
                timeout: 15_000,
            });

            // Verify the IPC layer agrees: needsRecovery must be true.
            const recoveryStatus = await relaunchedWindow.evaluate(() =>
                (globalThis as RendererGlobal).__chimera.saves.checkCrashRecovery(),
            );
            expect(recoveryStatus.needsRecovery).toBe(true);
            expect(recoveryStatus.slotId).not.toBeNull();

            // Wait for the direct-match canvas before clicking Resume so
            // SessionRuntime.applyRestoredFile() has an active session.
            // Without this, the load IPC call is silently skipped
            // (see electron/main/index.ts: "snapshot will not be applied").
            await expect(new MatchPage(relaunchedWindow).canvas).toBeVisible({ timeout: 30_000 });

            // Accept the prompt — this calls window.__chimera.saves.load(slotId)
            // via the banner's handleResume(), which routes through IPC to
            // SessionRuntime.applyRestoredFile() (Invariant #24).
            await relaunchedWindow.getByRole('button', { name: /resume last session/i }).click();

            // Assert tick equality: the restored GameSnapshot checkpoint must
            // have the same tick as the one captured by triggerCrashSave().
            await expect
                .poll(() => getSimulationTick(relaunchedApp), { timeout: 30_000 })
                .toBe(savedTick);
        } finally {
            await relaunchedApp.close();
        }
    });
});
