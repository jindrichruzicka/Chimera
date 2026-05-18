// @vitest-environment jsdom

/**
 * renderer/components/shell/perf/perfStore.test.ts
 *
 * Unit tests for the perfStore Zustand store.
 * Architecture: §4.16 — Performance HUD
 * Task: issue #581 — Implement perfStore.ts
 *
 * Rules:
 *  - No real Electron IPC — all tests use the createPerfStore() factory.
 *  - No imports from simulation/, electron/, ai/, or games/*.
 *  - Tests written first (red confirmed), then implementation added.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPerfStore, usePerfStore, type PerfSample, type PerfFrameSample } from './perfStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFrame(overrides: Partial<PerfFrameSample> = {}): PerfFrameSample {
    return {
        fps: 60,
        frameMsAvg: 16.6,
        frameMsP95: 18.0,
        drawCalls: 120,
        triangles: 50000,
        ...overrides,
    };
}

// ── Initial state ─────────────────────────────────────────────────────────────

describe('perfStore — initial state', () => {
    it('initialises visible as false', () => {
        const store = createPerfStore();
        expect(store.getState().visible).toBe(false);
    });

    it('initialises fps as 0', () => {
        const store = createPerfStore();
        expect(store.getState().sample.fps).toBe(0);
    });

    it('initialises frameMsAvg as 0', () => {
        const store = createPerfStore();
        expect(store.getState().sample.frameMsAvg).toBe(0);
    });

    it('initialises frameMsP95 as 0', () => {
        const store = createPerfStore();
        expect(store.getState().sample.frameMsP95).toBe(0);
    });

    it('initialises simTick as 0', () => {
        const store = createPerfStore();
        expect(store.getState().sample.simTick).toBe(0);
    });

    it('initialises actionsPerSec as 0', () => {
        const store = createPerfStore();
        expect(store.getState().sample.actionsPerSec).toBe(0);
    });

    it('initialises actionRoundTripMs as null', () => {
        const store = createPerfStore();
        expect(store.getState().sample.actionRoundTripMs).toBeNull();
    });

    it('initialises pingMs as null', () => {
        const store = createPerfStore();
        expect(store.getState().sample.pingMs).toBeNull();
    });

    it('initialises heapMb as null', () => {
        const store = createPerfStore();
        expect(store.getState().sample.heapMb).toBeNull();
    });

    it('initialises drawCalls as 0', () => {
        const store = createPerfStore();
        expect(store.getState().sample.drawCalls).toBe(0);
    });

    it('initialises triangles as 0', () => {
        const store = createPerfStore();
        expect(store.getState().sample.triangles).toBe(0);
    });
});

// ── toggle() ─────────────────────────────────────────────────────────────────

describe('perfStore.toggle()', () => {
    it('flips visible from false to true', () => {
        const store = createPerfStore();
        store.getState().toggle();
        expect(store.getState().visible).toBe(true);
    });

    it('flips visible from true back to false', () => {
        const store = createPerfStore();
        store.getState().toggle();
        store.getState().toggle();
        expect(store.getState().visible).toBe(false);
    });

    it('alternates on repeated calls', () => {
        const store = createPerfStore();
        store.getState().toggle();
        store.getState().toggle();
        store.getState().toggle();
        expect(store.getState().visible).toBe(true);
    });
});

// ── setVisible() ──────────────────────────────────────────────────────────────

describe('perfStore.setVisible()', () => {
    it('sets visible to true', () => {
        const store = createPerfStore();
        store.getState().setVisible(true);
        expect(store.getState().visible).toBe(true);
    });

    it('sets visible to false', () => {
        const store = createPerfStore();
        store.getState().setVisible(true);
        store.getState().setVisible(false);
        expect(store.getState().visible).toBe(false);
    });

    it('idempotent when already at the same value', () => {
        const store = createPerfStore();
        store.getState().setVisible(false);
        expect(store.getState().visible).toBe(false);
    });
});

// ── setPerfFrame() ────────────────────────────────────────────────────────────

describe('perfStore.setPerfFrame()', () => {
    it('updates fps', () => {
        const store = createPerfStore();
        store.getState().setPerfFrame(makeFrame({ fps: 55 }));
        expect(store.getState().sample.fps).toBe(55);
    });

    it('updates frameMsAvg', () => {
        const store = createPerfStore();
        store.getState().setPerfFrame(makeFrame({ frameMsAvg: 17.5 }));
        expect(store.getState().sample.frameMsAvg).toBe(17.5);
    });

    it('updates frameMsP95', () => {
        const store = createPerfStore();
        store.getState().setPerfFrame(makeFrame({ frameMsP95: 22.0 }));
        expect(store.getState().sample.frameMsP95).toBe(22.0);
    });

    it('updates drawCalls', () => {
        const store = createPerfStore();
        store.getState().setPerfFrame(makeFrame({ drawCalls: 200 }));
        expect(store.getState().sample.drawCalls).toBe(200);
    });

    it('updates triangles', () => {
        const store = createPerfStore();
        store.getState().setPerfFrame(makeFrame({ triangles: 99000 }));
        expect(store.getState().sample.triangles).toBe(99000);
    });

    it('does not affect simTick or pingMs', () => {
        const store = createPerfStore();
        store.getState().setPingMs(50);
        store.getState().setSimTick(42);
        store.getState().setPerfFrame(makeFrame());
        expect(store.getState().sample.pingMs).toBe(50);
        expect(store.getState().sample.simTick).toBe(42);
    });
});

// ── setSimTick() ──────────────────────────────────────────────────────────────

describe('perfStore.setSimTick()', () => {
    it('updates simTick', () => {
        const store = createPerfStore();
        store.getState().setSimTick(7);
        expect(store.getState().sample.simTick).toBe(7);
    });

    it('does not affect frame metrics', () => {
        const store = createPerfStore();
        store.getState().setPerfFrame(makeFrame({ fps: 60 }));
        store.getState().setSimTick(7);
        expect(store.getState().sample.fps).toBe(60);
    });
});

// ── setPingMs() ───────────────────────────────────────────────────────────────

describe('perfStore.setPingMs()', () => {
    it('updates pingMs to a numeric value', () => {
        const store = createPerfStore();
        store.getState().setPingMs(42);
        expect(store.getState().sample.pingMs).toBe(42);
    });

    it('clears pingMs to null', () => {
        const store = createPerfStore();
        store.getState().setPingMs(42);
        store.getState().setPingMs(null);
        expect(store.getState().sample.pingMs).toBeNull();
    });
});

// ── recordActionDispatched / recordSnapshotReceived ───────────────────────────

describe('perfStore — action round-trip', () => {
    it('actionRoundTripMs is null before any dispatch', () => {
        const store = createPerfStore();
        expect(store.getState().sample.actionRoundTripMs).toBeNull();
    });

    it('remains null after dispatch alone (no snapshot yet)', () => {
        const store = createPerfStore();
        store.getState().recordActionDispatched(1000);
        expect(store.getState().sample.actionRoundTripMs).toBeNull();
    });

    it('computes RTT when snapshot arrives after dispatch', () => {
        const store = createPerfStore();
        store.getState().recordActionDispatched(1000);
        store.getState().recordSnapshotReceived(1, 1080);
        // RTT = 1080 - 1000 = 80
        expect(store.getState().sample.actionRoundTripMs).toBe(80);
    });

    it('RTT is non-negative (clamp)', () => {
        const store = createPerfStore();
        store.getState().recordActionDispatched(2000);
        store.getState().recordSnapshotReceived(1, 1900); // clock anomaly
        expect(store.getState().sample.actionRoundTripMs).toBeGreaterThanOrEqual(0);
    });

    it('uses the oldest pending dispatch stamp when multiple are queued', () => {
        const store = createPerfStore();
        store.getState().recordActionDispatched(1000);
        store.getState().recordActionDispatched(1020);
        store.getState().recordSnapshotReceived(1, 1100);
        // oldest dispatch was at 1000; RTT = 100
        expect(store.getState().sample.actionRoundTripMs).toBe(100);
    });

    it('clears the pending dispatch after computing RTT (no double-count)', () => {
        const store = createPerfStore();
        store.getState().recordActionDispatched(1000);
        store.getState().recordSnapshotReceived(1, 1080);
        const first = store.getState().sample.actionRoundTripMs;
        // Calling recordSnapshotReceived again without a new dispatch should not
        // modify actionRoundTripMs (no pending stamps left to consume).
        store.getState().recordSnapshotReceived(2, 1200);
        expect(store.getState().sample.actionRoundTripMs).toBe(first);
    });
});

// ── actionsPerSec (rolling 1 s window) ───────────────────────────────────────

describe('perfStore — actionsPerSec rolling count', () => {
    let nowMs: number;

    beforeEach(() => {
        nowMs = 1_000_000;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('starts at 0 before any snapshot arrivals', () => {
        const store = createPerfStore();
        expect(store.getState().sample.actionsPerSec).toBe(0);
    });

    it('counts snapshots received within the last 1000 ms', () => {
        const store = createPerfStore();
        // Record 3 snapshots, all within the 1 s window
        store.getState().recordSnapshotReceived(1, nowMs - 200);
        store.getState().recordSnapshotReceived(2, nowMs - 100);
        store.getState().recordSnapshotReceived(3, nowMs);
        expect(store.getState().sample.actionsPerSec).toBe(3);
    });

    it('excludes snapshots older than 1000 ms', () => {
        const store = createPerfStore();
        store.getState().recordSnapshotReceived(1, nowMs - 1500); // stale
        store.getState().recordSnapshotReceived(2, nowMs - 500); // fresh
        expect(store.getState().sample.actionsPerSec).toBe(1);
    });

    it('drops to 0 when all snapshots fall outside the window', () => {
        const store = createPerfStore();
        store.getState().recordSnapshotReceived(1, nowMs - 2000);
        store.getState().recordSnapshotReceived(2, nowMs - 1500);
        // Move time forward so all past arrivals are now stale
        nowMs += 3000;
        store.getState().recordSnapshotReceived(3, nowMs); // triggers recount
        expect(store.getState().sample.actionsPerSec).toBe(1);
    });
});

// ── heapMb ────────────────────────────────────────────────────────────────────

describe('perfStore — heapMb sampling', () => {
    it('returns null when performance.memory is absent', () => {
        const store = createPerfStore();
        // jsdom does not expose performance.memory — heapMb stays null
        expect(store.getState().sample.heapMb).toBeNull();
    });

    it('returns non-null when performance.memory.usedJSHeapSize is available', () => {
        // Simulate Chromium-like memory API
        const originalMemory = (performance as unknown as Record<string, unknown>)['memory'];
        Object.defineProperty(performance, 'memory', {
            value: { usedJSHeapSize: 52_428_800, totalJSHeapSize: 100_000_000 },
            configurable: true,
            writable: true,
        });

        const store = createPerfStore();
        store.getState().sampleHeap();

        const heapMb = store.getState().sample.heapMb;
        expect(heapMb).not.toBeNull();
        // 52_428_800 / (1024 * 1024) ≈ 50 MB
        expect(heapMb).toBeCloseTo(50, 0);

        // Restore
        if (originalMemory === undefined) {
            delete (performance as unknown as Record<string, unknown>)['memory'];
        } else {
            Object.defineProperty(performance, 'memory', {
                value: originalMemory,
                configurable: true,
                writable: true,
            });
        }
    });
});

// ── PerfSample type shape ─────────────────────────────────────────────────────

describe('PerfSample type shape', () => {
    it('sample has all ten required fields', () => {
        const store = createPerfStore();
        const sample: PerfSample = store.getState().sample;
        expect('fps' in sample).toBe(true);
        expect('frameMsAvg' in sample).toBe(true);
        expect('frameMsP95' in sample).toBe(true);
        expect('simTick' in sample).toBe(true);
        expect('actionsPerSec' in sample).toBe(true);
        expect('actionRoundTripMs' in sample).toBe(true);
        expect('pingMs' in sample).toBe(true);
        expect('heapMb' in sample).toBe(true);
        expect('drawCalls' in sample).toBe(true);
        expect('triangles' in sample).toBe(true);
    });
});

// ── singleton usePerfStore ────────────────────────────────────────────────────

describe('usePerfStore singleton', () => {
    it('exposes getState on the hook (for bootstrap wiring)', () => {
        expect(typeof usePerfStore.getState).toBe('function');
    });

    it('exposes subscribe on the hook (for reactive binding)', () => {
        expect(typeof usePerfStore.subscribe).toBe('function');
    });

    it('does NOT expose setState (§5.5 store mutation ownership)', () => {
        expect(typeof (usePerfStore as any).setState).toBe('undefined');
    });

    it('getState returns the initial sample', () => {
        const state = usePerfStore.getState();
        expect(state.sample).toBeDefined();
        expect(state.visible).toBe(false);
    });
});
