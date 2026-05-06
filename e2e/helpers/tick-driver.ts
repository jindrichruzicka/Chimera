/**
 * e2e/helpers/tick-driver.ts
 *
 * Programmatic tick dispatch helper for soak specs. Dispatches a specified
 * number of ticks to the simulation host via `electronApp.evaluate()`, calling
 * `__e2eHooks.dispatchTick()` registered under `CHIMERA_E2E=1`. Yields to the
 * event loop between batches to avoid flooding the message queue.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 * Issue: #474
 *
 * Invariants upheld:
 *   #2 — tick driver does not inject state; it only advances the clock via the
 *        registered hook. reduce()/applyAction() remain pure.
 *   #6 — Actions triggered by tick dispatch go through the full ActionPipeline
 *        validation path inside the main process.
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or networking/.
 * ElectronApplication is the only external import — it is a Playwright test type.
 */

import type { ElectronApplication } from '@playwright/test';

/** Number of ticks dispatched per batch before yielding to the event loop. */
const DEFAULT_BATCH_SIZE = 100;

/**
 * Dispatch `count` ticks to the simulation host via the CHIMERA_E2E hook.
 *
 * Ticks are dispatched in batches of `batchSize`. After each batch (except the
 * final one) the helper yields to the Node.js event loop via `setTimeout(0)` so
 * that pending I/O and IPC callbacks can drain before the next batch starts.
 *
 * Requires `CHIMERA_E2E=1` — `__e2eHooks.dispatchTick` must have been wired by
 * the session runtime before calling this function. When `__e2eHooks` is absent
 * the function resolves immediately without throwing.
 *
 * @param app       - The Playwright `ElectronApplication` for the host process.
 * @param count     - Total number of ticks to dispatch. `0` is a no-op.
 * @param batchSize - Ticks per batch before yielding (default: 100).
 */
export async function tick(
    app: ElectronApplication,
    count: number,
    batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<void> {
    // Guard against batchSize <= 0 to prevent infinite loop
    const safeBatchSize = Math.max(1, batchSize);
    let dispatched = 0;

    while (dispatched < count) {
        const batch = Math.min(count - dispatched, safeBatchSize);

        await app.evaluate((_electron, n: number) => {
            for (let i = 0; i < n; i++) {
                globalThis.__e2eHooks?.dispatchTick();
            }
        }, batch);

        dispatched += batch;

        if (dispatched < count) {
            // Yield to the event loop between batches to prevent flooding.
            await app.evaluate(() => new Promise<void>((r) => setTimeout(r, 0)));
        }
    }
}
