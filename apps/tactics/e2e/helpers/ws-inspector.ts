/**
 * e2e/helpers/ws-inspector.ts
 *
 * Read-only helpers that record and inspect raw WebSocket frames from the
 * Electron main process via electronApp.evaluate(). Requires CHIMERA_E2E=1 —
 * the networking layer appends frames to globalThis.__e2eHooks.wsFrames when
 * that flag is set.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 * Issue: #472
 *
 * Invariants upheld:
 *   #6  — Interceptor is purely read-only; it never injects or modifies frames.
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or networking/.
 * ElectronApplication is the only external import — it is a Playwright test type.
 */

import type { ElectronApplication } from '@playwright/test';

/**
 * WsFrame type derived from the globally-declared __e2eHooks shape
 * (electron/main/runtime/e2e-hooks.ts). Using typeof avoids a cross-module
 * import from electron/main/.
 */
export type WsFrame = NonNullable<NonNullable<typeof globalThis.__e2eHooks>['wsFrames']>[number];

/**
 * Ensure the WebSocket frame buffer is initialized on __e2eHooks.
 * Call this once at the start of a test before any actions that generate
 * WebSocket traffic. Graceful no-op when CHIMERA_E2E is off (__e2eHooks absent).
 *
 * Does NOT modify, delay, or drop frames — it only initializes the buffer
 * so the networking-layer hook can start appending (Invariant #6).
 */
export async function tapWebSocketFrames(
    app: Pick<ElectronApplication, 'evaluate'>,
): Promise<void> {
    await app.evaluate(() => {
        if (globalThis.__e2eHooks) {
            globalThis.__e2eHooks.wsFrames ??= [];
        }
    });
}

/**
 * Retrieve all WebSocket frames recorded since the last clearCapturedFrames()
 * (or since tapWebSocketFrames() if never cleared).
 * Returns [] when __e2eHooks is absent or the buffer has not been initialized.
 */
export async function getCapturedFrames(
    app: Pick<ElectronApplication, 'evaluate'>,
): Promise<WsFrame[]> {
    return app.evaluate(() => globalThis.__e2eHooks?.wsFrames ?? []);
}

/**
 * Reset the WebSocket frame buffer to empty.
 * Graceful no-op when CHIMERA_E2E is off (__e2eHooks absent).
 */
export async function clearCapturedFrames(
    app: Pick<ElectronApplication, 'evaluate'>,
): Promise<void> {
    await app.evaluate(() => {
        if (globalThis.__e2eHooks) {
            globalThis.__e2eHooks.wsFrames = [];
        }
    });
}
