/**
 * e2e/helpers/ipc-spy.ts
 *
 * Read-only helpers that inspect test-hook state from the Electron main process
 * via electronApp.evaluate(). Requires CHIMERA_E2E=1 — the main process registers
 * globalThis.__e2eHooks in simulation-host.ts when that flag is set.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 *
 * Invariants upheld:
 *   #3  — Returns PlayerSnapshot only; never GameSnapshot.
 *   #8  — Reads already-projected snapshot stored by StateBroadcaster via hooks;
 *          never accesses GameSnapshot directly.
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or networking/.
 * ElectronApplication is the only external import — it is a Playwright test type.
 */

import type { ElectronApplication } from '@playwright/test';

/**
 * The type of the lastHostSnapshot field, derived from the globally-declared
 * __e2eHooks shape (electron/main/runtime/e2e-hooks.ts). Using typeof avoids
 * a cross-module import from electron/main/ or simulation/.
 */
type HostSnapshot = NonNullable<typeof globalThis.__e2eHooks>['lastHostSnapshot'];
type LastSavedSlotId = NonNullable<typeof globalThis.__e2eHooks>['lastSavedSlotId'];
type LastSavedTick = NonNullable<typeof globalThis.__e2eHooks>['lastSavedTick'];

/**
 * Read the last PlayerSnapshot delivered to the host renderer.
 * Requires CHIMERA_E2E=1 — main process stores it on globalThis.__e2eHooks.
 * Returns null when __e2eHooks is absent or lastHostSnapshot is not yet set.
 */
export async function getHostSnapshot(app: ElectronApplication): Promise<HostSnapshot> {
    return app.evaluate(() => globalThis.__e2eHooks?.lastHostSnapshot ?? null);
}

/**
 * Retrieve the current simulation tick from the host process (not the renderer).
 * Uses the same __e2eHooks mechanism — avoids reading from renderer DOM.
 * Returns 0 when __e2eHooks is absent.
 */
export async function getSimulationTick(app: ElectronApplication): Promise<number> {
    return app.evaluate(() => globalThis.__e2eHooks?.currentTick ?? 0);
}

/**
 * Retrieve the last checksum observed by the process.
 * Prefer getLastBroadcastChecksums() when comparing multiplayer convergence;
 * this scalar is retained for lower-level hook diagnostics.
 * Returns 0 when __e2eHooks is absent.
 */
export async function getLastBroadcastChecksum(app: ElectronApplication): Promise<number> {
    return app.evaluate(() => globalThis.__e2eHooks?.lastChecksum ?? 0);
}

/**
 * Retrieve the last broadcast checksum keyed by projected viewer id.
 * Used by soak tests so the host's checksum for a specific remote viewer is
 * compared with that same client's received checksum, independent of player-map
 * broadcast ordering.
 */
export async function getLastBroadcastChecksums(
    app: ElectronApplication,
): Promise<Readonly<Record<string, number>>> {
    return app.evaluate(() => globalThis.__e2eHooks?.broadcastChecksums ?? {});
}

/**
 * Retrieve the qualified slot id persisted by the last successful save.
 * Returns null when __e2eHooks is absent or no save has completed yet.
 */
export async function getLastSavedSlotId(app: ElectronApplication): Promise<LastSavedSlotId> {
    return app.evaluate(() => globalThis.__e2eHooks?.lastSavedSlotId ?? null);
}

/**
 * Retrieve the checkpoint tick captured by the last successful save.
 * Returns null when __e2eHooks is absent or no save has completed yet.
 */
export async function getLastSavedTick(app: ElectronApplication): Promise<LastSavedTick> {
    return app.evaluate(() => globalThis.__e2eHooks?.lastSavedTick ?? null);
}
