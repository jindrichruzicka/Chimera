/**
 * F34 — crash-recovery.spec.ts
 * §13.8 Core E2E Test Specifications · §4.11 Save/Load Persistence
 *
 * Part of #526. Implements issue #528.
 *
 * Verifies the crash-recovery lifecycle:
 *   1. Launch a single-player (pass-and-play) match.
 *   2. Play several turns to advance the simulation tick and trigger autosave.
 *   3. Wait for autosave to write the `tactics/autosave` slot (fire-and-forget
 *      after engine:end_turn; polled here before kill so the kill is deterministic).
 *   4. Record the pre-kill simulation tick via getSimulationTick().
 *   5. Force-kill the Electron process with SIGKILL (no `before-quit` handler runs
 *      so `lastCleanExit.flag` is NOT written — simulates a crash).
 *   6. Relaunch with the same `--user-data-dir` so the saved data is available.
 *   7. Assert that the `crash-recovery-banner` is visible ("Resume" prompt shown).
 *   8. Wait for the match canvas to be visible before clicking Resume, so
 *      SessionRuntime.applyRestoredFile() has an active session to restore into.
 *   9. Click "Resume last session".
 *  10. Assert getSimulationTick() matches the tick recorded before force-kill.
 *
 * Invariants upheld:
 *   #23 — FileSaveRepository writes via .tmp rename; the autosave slot we read
 *          is the complete, renamed file.
 *   #24 — SessionRuntime.applyRestoredFile() is the only restore entry point;
 *          the test triggers load via the preload bridge ("Resume last session"
 *          button), which calls window.__chimera.saves.load(slotId) → IPC →
 *          SessionRuntime.applyRestoredFile().
 *   #68 — Crash reporter runs autosave before crash dump; SIGKILL bypasses the
 *          uncaughtException handler, so the autosave created by end_turn is
 *          the recovery source — never from the crash dump path.
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or
 * networking/. ElectronApplication, Page, and the Playwright test types are
 * the only external imports.
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

interface CrashRecoveryStatusResult {
    readonly needsRecovery: boolean;
    readonly slotId: string | null;
}

interface RendererSavesBridge {
    list(gameId: string): Promise<SaveSlotMetaResult[]>;
    checkCrashRecovery(): Promise<CrashRecoveryStatusResult>;
}

type RendererGlobal = typeof globalThis & {
    readonly __chimera: { readonly saves: RendererSavesBridge };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Poll `window.__chimera.saves.list('tactics')` until the autosave slot
 * reports a tick value >= the supplied baseline, then return the saved tick.
 *
 * Autosave is fire-and-forget after engine:end_turn. We must not kill the
 * process until the autosave file has landed on disk to avoid recovering
 * from an older snapshot than expected.
 */
async function waitForAutosave(page: Page, minimumTick: number, timeout = 30_000): Promise<number> {
    let savedTick = 0;
    await expect
        .poll(
            async () => {
                const slots = await page.evaluate(() =>
                    (globalThis as RendererGlobal).__chimera.saves.list('tactics'),
                );
                const autosave = slots.find((s) => s.slotId === 'tactics/autosave');
                savedTick = autosave?.tick ?? 0;
                return savedTick;
            },
            { timeout },
        )
        .toBeGreaterThanOrEqual(minimumTick);
    return savedTick;
}

/**
 * Force-kill the Electron process with SIGKILL and wait for Playwright's
 * 'close' event, confirming the OS has reaped the child.
 *
 * `electronApp.close()` triggers a graceful shutdown and writes
 * `lastCleanExit.flag`; SIGKILL bypasses all handlers so the flag is absent
 * on relaunch, which is the precondition for crash recovery.
 */
async function forceKill(app: ElectronApplication): Promise<void> {
    const closeEvent = app.waitForEvent('close');
    app.process().kill('SIGKILL');
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
    test('tick is restored to pre-kill value after SIGKILL, relaunch, and Resume', async ({
        crashApp,
        crashWindow,
    }) => {
        const match = new MatchPage(crashWindow);

        // Wait for the match canvas — direct-match boot may need a moment.
        await expect(match.canvas).toBeVisible({ timeout: 30_000 });

        // Play 3 turns in pass-and-play mode. Each end_turn fires autosave
        // as a fire-and-forget side-effect (HostSessionPipeline, Invariant #25).
        for (let turn = 0; turn < 3; turn++) {
            await expect(match.endTurnButton).toBeEnabled({ timeout: 30_000 });
            await match.moveOwnedUnit();
            await match.endTurnButton.click();
            // Wait for the handoff: button goes disabled then re-enables.
            await expect(match.endTurnButton).toBeDisabled();
            await expect(match.endTurnButton).toBeEnabled({ timeout: 30_000 });
        }

        // Record the live tick before killing. This is the value the test
        // asserts must match after recovery.
        const tickBeforeKill = await getSimulationTick(crashApp);
        expect(tickBeforeKill).toBeGreaterThan(0);

        // Wait until the autosave slot reports a tick >= tickBeforeKill so
        // we do not kill before the autosave I/O has completed.
        await waitForAutosave(crashWindow, tickBeforeKill);

        // Capture the launch config (args carry --user-data-dir so the
        // relaunched process finds the same saves directory).
        const relaunchConfig = await captureRelaunchConfig(crashApp);

        // Force-kill with SIGKILL — no before-quit handler runs, so
        // lastCleanExit.flag is NOT written. This is what makes the relaunch
        // present the "Resume" prompt (Invariant #68 concern is irrelevant
        // here: SIGKILL bypasses uncaughtException too).
        await forceKill(crashApp);

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
            // have the same tick as the one we recorded before force-kill.
            await expect
                .poll(() => getSimulationTick(relaunchedApp), { timeout: 30_000 })
                .toBe(tickBeforeKill);
        } finally {
            await relaunchedApp.close();
        }
    });
});
