/**
 * e2e/helpers/ws-inspector.test.ts
 *
 * Unit tests for ws-inspector helpers. Mocks ElectronApplication.evaluate() to
 * execute callbacks in-process, then manipulates globalThis.__e2eHooks to
 * verify both present-hooks and absent-hooks (default-value) paths.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 * Issue: #472
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ElectronApplication } from '@playwright/test';
import { tapWebSocketFrames, getCapturedFrames, clearCapturedFrames } from './ws-inspector';
import type { WsFrame } from './ws-inspector';

// ---------------------------------------------------------------------------
// Test helper — mock ElectronApplication that executes callbacks in-process
// ---------------------------------------------------------------------------

function makeApp(): Pick<ElectronApplication, 'evaluate'> {
    return {
        evaluate: vi.fn().mockImplementation(<TReturn>(fn: () => TReturn): Promise<TReturn> => {
            return Promise.resolve(fn());
        }),
    };
}

// Keep a reference so tests can mutate without dot-notation TS errors
const g = globalThis as Record<string, unknown>;

afterEach(() => {
    // Reset hooks between tests so state doesn't leak
    globalThis.__e2eHooks = undefined;
});

// ---------------------------------------------------------------------------
// tapWebSocketFrames
// ---------------------------------------------------------------------------

describe('tapWebSocketFrames', () => {
    it('initializes wsFrames array on __e2eHooks when hooks are registered', async () => {
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 0,
            onTick: () => undefined,
        };

        await tapWebSocketFrames(makeApp());

        expect((g['__e2eHooks'] as Record<string, unknown>)['wsFrames']).toEqual([]);
    });

    it('does not throw when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;

        await expect(tapWebSocketFrames(makeApp())).resolves.toBeUndefined();
    });

    it('does not overwrite existing wsFrames array', async () => {
        const existingFrame: WsFrame = { direction: 'inbound', data: '{"tick":1}', timestamp: 100 };
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 0,
            onTick: () => undefined,
            wsFrames: [existingFrame],
        };

        await tapWebSocketFrames(makeApp());

        expect((g['__e2eHooks'] as Record<string, unknown>)['wsFrames']).toEqual([existingFrame]);
    });

    it('calls app.evaluate exactly once', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await tapWebSocketFrames(app);

        expect(app.evaluate).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// getCapturedFrames
// ---------------------------------------------------------------------------

describe('getCapturedFrames', () => {
    it('returns captured frames from wsFrames when hooks are registered', async () => {
        const frames: WsFrame[] = [
            { direction: 'inbound', data: '{"tick":1}', timestamp: 100 },
            { direction: 'outbound', data: '{"action":"move"}', timestamp: 200 },
        ];
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 0,
            onTick: () => undefined,
            wsFrames: frames,
        };

        const result = await getCapturedFrames(makeApp());

        expect(result).toEqual(frames);
    });

    it('returns [] when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;

        const result = await getCapturedFrames(makeApp());

        expect(result).toEqual([]);
    });

    it('returns [] when wsFrames is not initialized on __e2eHooks', async () => {
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 0,
            onTick: () => undefined,
        };

        const result = await getCapturedFrames(makeApp());

        expect(result).toEqual([]);
    });

    it('calls app.evaluate exactly once', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await getCapturedFrames(app);

        expect(app.evaluate).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// clearCapturedFrames
// ---------------------------------------------------------------------------

describe('clearCapturedFrames', () => {
    it('resets wsFrames to empty array when hooks are registered', async () => {
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 0,
            onTick: () => undefined,
            wsFrames: [{ direction: 'inbound' as const, data: 'data', timestamp: 1 }],
        };

        await clearCapturedFrames(makeApp());

        expect((g['__e2eHooks'] as Record<string, unknown>)['wsFrames']).toEqual([]);
    });

    it('does not throw when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;

        await expect(clearCapturedFrames(makeApp())).resolves.toBeUndefined();
    });

    it('calls app.evaluate exactly once', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await clearCapturedFrames(app);

        expect(app.evaluate).toHaveBeenCalledTimes(1);
    });
});
