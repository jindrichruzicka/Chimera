/**
 * e2e/helpers/ipc-spy.test.ts
 *
 * Unit tests for ipc-spy helpers. Mocks ElectronApplication.evaluate() to
 * execute callbacks in-process, then manipulates globalThis.__e2eHooks to
 * verify both present-hooks and absent-hooks (default-value) paths.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 * Issue: #471
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ElectronApplication } from '@playwright/test';
import {
    getHostSnapshot,
    getSimulationTick,
    getLastBroadcastChecksum,
    getLastBroadcastChecksums,
    getLastSavedSlotId,
    getLastSavedTick,
} from './ipc-spy';

// ---------------------------------------------------------------------------
// Test helper — mock ElectronApplication that executes callbacks in-process
// ---------------------------------------------------------------------------

function makeApp(): ElectronApplication {
    return {
        evaluate: vi.fn().mockImplementation(<TReturn>(fn: () => TReturn): Promise<TReturn> => {
            return Promise.resolve(fn());
        }),
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
// getHostSnapshot
// ---------------------------------------------------------------------------

describe('getHostSnapshot', () => {
    it('returns lastHostSnapshot from __e2eHooks when hooks are registered', async () => {
        const snapshot = {
            tick: 3,
            viewerId: 'p1',
            phase: 'playing',
            players: {},
            entities: {},
            events: [],
            commitments: {},
            undoMeta: { canUndo: false, canRedo: false },
        };
        g['__e2eHooks'] = {
            lastHostSnapshot: snapshot,
            currentTick: 3,
            lastChecksum: 7,
            broadcastChecksums: { p1: 7 },
            onTick: () => undefined,
        };

        const result = await getHostSnapshot(makeApp());

        expect(result).toBe(snapshot);
    });

    it('returns null when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;

        const result = await getHostSnapshot(makeApp());

        expect(result).toBeNull();
    });

    it('returns null when __e2eHooks is present but lastHostSnapshot is null', async () => {
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 0,
            broadcastChecksums: {},
            onTick: () => undefined,
        };

        const result = await getHostSnapshot(makeApp());

        expect(result).toBeNull();
    });

    it('calls app.evaluate exactly once', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await getHostSnapshot(app);

        expect(app.evaluate).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// getSimulationTick
// ---------------------------------------------------------------------------

describe('getSimulationTick', () => {
    it('returns currentTick from __e2eHooks when hooks are registered', async () => {
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 42,
            lastChecksum: 0,
            broadcastChecksums: {},
            onTick: () => undefined,
        };

        const result = await getSimulationTick(makeApp());

        expect(result).toBe(42);
    });

    it('returns 0 when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;

        const result = await getSimulationTick(makeApp());

        expect(result).toBe(0);
    });

    it('calls app.evaluate exactly once', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await getSimulationTick(app);

        expect(app.evaluate).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// getLastBroadcastChecksum
// ---------------------------------------------------------------------------

describe('getLastBroadcastChecksum', () => {
    it('returns lastChecksum from __e2eHooks when hooks are registered', async () => {
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 99,
            broadcastChecksums: { p2: 99 },
            onTick: () => undefined,
        };

        const result = await getLastBroadcastChecksum(makeApp());

        expect(result).toBe(99);
    });

    it('returns 0 when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;

        const result = await getLastBroadcastChecksum(makeApp());

        expect(result).toBe(0);
    });

    it('calls app.evaluate exactly once', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await getLastBroadcastChecksum(app);

        expect(app.evaluate).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// getLastBroadcastChecksums
// ---------------------------------------------------------------------------

describe('getLastBroadcastChecksums', () => {
    it('returns broadcastChecksums from __e2eHooks when hooks are registered', async () => {
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 99,
            broadcastChecksums: { p1: 11, p2: 99 },
            onTick: () => undefined,
        };

        const result = await getLastBroadcastChecksums(makeApp());

        expect(result).toEqual({ p1: 11, p2: 99 });
    });

    it('returns an empty checksum map when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;

        const result = await getLastBroadcastChecksums(makeApp());

        expect(result).toEqual({});
    });

    it('calls app.evaluate exactly once', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await getLastBroadcastChecksums(app);

        expect(app.evaluate).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// getLastSavedSlotId
// ---------------------------------------------------------------------------

describe('getLastSavedSlotId', () => {
    it('returns lastSavedSlotId from __e2eHooks when hooks are registered', async () => {
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 0,
            broadcastChecksums: {},
            lastSavedSlotId: 'tactics/slot-1',
            lastSavedTick: 42,
            onTick: () => undefined,
        };

        const result = await getLastSavedSlotId(makeApp());

        expect(result).toBe('tactics/slot-1');
    });

    it('returns null when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;

        const result = await getLastSavedSlotId(makeApp());

        expect(result).toBeNull();
    });

    it('calls app.evaluate exactly once', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await getLastSavedSlotId(app);

        expect(app.evaluate).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// getLastSavedTick
// ---------------------------------------------------------------------------

describe('getLastSavedTick', () => {
    it('returns lastSavedTick from __e2eHooks when hooks are registered', async () => {
        g['__e2eHooks'] = {
            lastHostSnapshot: null,
            currentTick: 0,
            lastChecksum: 0,
            broadcastChecksums: {},
            lastSavedSlotId: 'tactics/slot-1',
            lastSavedTick: 42,
            onTick: () => undefined,
        };

        const result = await getLastSavedTick(makeApp());

        expect(result).toBe(42);
    });

    it('returns null when __e2eHooks is absent', async () => {
        globalThis.__e2eHooks = undefined;

        const result = await getLastSavedTick(makeApp());

        expect(result).toBeNull();
    });

    it('calls app.evaluate exactly once', async () => {
        globalThis.__e2eHooks = undefined;
        const app = makeApp();

        await getLastSavedTick(app);

        expect(app.evaluate).toHaveBeenCalledTimes(1);
    });
});
