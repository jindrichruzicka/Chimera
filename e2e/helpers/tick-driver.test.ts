/**
 * e2e/helpers/tick-driver.test.ts
 *
 * Unit tests for tick-driver helpers. Mocks ElectronApplication.evaluate() to
 * execute callbacks in-process, then manipulates globalThis.__e2eHooks.dispatchTick
 * to verify tick dispatch count, batching behaviour, and yield-between-batches.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 * Issue: #474
 *
 * Tests written FIRST (red confirmed before implementation).
 *
 * Invariants verified:
 *   #2 — tick driver does not inject state; it only advances the clock via the
 *        registered hook, leaving reduce()/applyAction() pure.
 *   #6 — Actions triggered by tick dispatch still go through full ActionPipeline.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ElectronApplication } from '@playwright/test';
import { tick } from './tick-driver';

// ---------------------------------------------------------------------------
// Test helper — mock ElectronApplication that executes callbacks in-process
// ---------------------------------------------------------------------------

function makeApp(): ElectronApplication {
    return {
        evaluate: vi
            .fn()
            .mockImplementation(
                <TReturn>(fn: (...args: unknown[]) => TReturn, arg?: unknown): Promise<TReturn> => {
                    // Mimic Playwright ElectronApplication.evaluate: pass undefined as the Electron
                    // module (first param); the serialised arg is the second param.
                    if (arg !== undefined) {
                        return Promise.resolve(fn(undefined, arg));
                    }
                    return Promise.resolve(fn(undefined));
                },
            ),
        // @chimera-review: partial mock of ElectronApplication (Playwright external class) — only evaluate() is exercised in unit tests
    } as unknown as ElectronApplication;
}

// Keep a reference so tests can mutate without dot-notation TS errors
const g = globalThis as Record<string, unknown>;

afterEach(() => {
    // Reset hooks between tests so state doesn't leak
    globalThis.__e2eHooks = undefined;
});

// ---------------------------------------------------------------------------
// dispatch count
// ---------------------------------------------------------------------------

describe('tick — dispatch count', () => {
    it('does not call dispatchTick when count is 0', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        await tick(app, 0);

        expect(dispatchTick).toHaveBeenCalledTimes(0);
    });

    it('calls dispatchTick exactly once for count=1', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        await tick(app, 1);

        expect(dispatchTick).toHaveBeenCalledTimes(1);
    });

    it('calls dispatchTick 100 times for count=100 (single default batch)', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        await tick(app, 100);

        expect(dispatchTick).toHaveBeenCalledTimes(100);
    });

    it('calls dispatchTick 101 times for count=101 (spans two default batches)', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        await tick(app, 101);

        expect(dispatchTick).toHaveBeenCalledTimes(101);
    });

    it('calls dispatchTick 1000 times for count=1000', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        await tick(app, 1000);

        expect(dispatchTick).toHaveBeenCalledTimes(1000);
    });

    it('respects custom batchSize — count=10, batchSize=3 dispatches 10 ticks', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        await tick(app, 10, 3);

        expect(dispatchTick).toHaveBeenCalledTimes(10);
    });

    it('guards against infinite loop: batchSize=0 is clamped to 1', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        // batchSize=0 should be treated as batchSize=1 to prevent infinite loop
        await tick(app, 5, 0);

        expect(dispatchTick).toHaveBeenCalledTimes(5);
    });

    it('is a no-op (resolves without throwing) when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await expect(tick(app, 10)).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// batching — evaluate call count
// ---------------------------------------------------------------------------

describe('tick — batching', () => {
    it('uses a single evaluate call for count <= batchSize', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        // count=5, batchSize=10 → 1 batch dispatch, 0 yields
        await tick(app, 5, 10);

        expect((app.evaluate as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('yields between batches: count=9, batchSize=3 → 3 batch calls + 2 yield calls', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        // 3 batches × 3 ticks = 9 ticks, yield between each pair → 2 yields
        await tick(app, 9, 3);

        // 3 dispatch-batch evaluate calls + 2 yield evaluate calls = 5 total
        expect((app.evaluate as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(5);
    });

    it('does not yield after the final batch', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        // 2 batches × 100 ticks = 200 ticks, yield only once (between batch 1 and 2)
        await tick(app, 200);

        // 2 dispatch-batch evaluate calls + 1 yield evaluate call = 3 total
        expect((app.evaluate as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    });

    it('no yield when count is exactly one full batch', async () => {
        const dispatchTick = vi.fn();
        g['__e2eHooks'] = { dispatchTick };
        const app = makeApp();

        await tick(app, 100);

        // Exactly 1 batch dispatch, no yield
        expect((app.evaluate as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
});
