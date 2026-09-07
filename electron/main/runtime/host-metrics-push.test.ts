/**
 * electron/main/runtime/host-metrics-push.test.ts
 *
 * Tests written FIRST (red) for the low-rate host-metrics push (§4.16).
 *
 * Invariants upheld:
 *   #3  — only scalar metrics cross IPC; no `GameSnapshot` is read here.
 *   #31 — this is a metrics push, not a second coupling to simulation: the
 *          sources are injected callbacks, and the module imports no
 *          simulation module other than the shared contract type.
 */

import { describe, expect, it, vi } from 'vitest';

import {
    HOST_METRICS_PUSH_INTERVAL_MS,
    readHostMetrics,
    startHostMetricsPush,
} from './host-metrics-push.js';

/** A controllable timer pair, so the interval is driven rather than waited on. */
function makeTimers(): {
    readonly timers: {
        setInterval: (handler: () => void, ms: number) => unknown;
        clearInterval: (handle: unknown) => void;
    };
    readonly fire: () => void;
    readonly intervals: number[];
    readonly cleared: unknown[];
} {
    const handlers: (() => void)[] = [];
    const intervals: number[] = [];
    const cleared: unknown[] = [];
    return {
        timers: {
            setInterval: (handler, ms) => {
                handlers.push(handler);
                intervals.push(ms);
                return handlers.length - 1;
            },
            clearInterval: (handle) => {
                cleared.push(handle);
            },
        },
        fire: () => {
            for (const handler of handlers) handler();
        },
        intervals,
        cleared,
    };
}

describe('readHostMetrics', () => {
    it('reports the host heap in megabytes', () => {
        const metrics = readHostMetrics({
            heapUsedBytes: () => 48 * 1024 * 1024,
            recordedActionCount: () => 0,
        });

        expect(metrics.hostHeapMb).toBe(48);
    });

    it('reports the recorder’s own count, not a capped debug-bridge array', () => {
        // The nearest existing metric, `PerfStats.totalActionCount`, reports the
        // debug bridge's array length, which saturates at its own capacity. This
        // reads whatever the source hands it, so a count well past that ceiling
        // arrives intact.
        const metrics = readHostMetrics({
            heapUsedBytes: () => 0,
            recordedActionCount: () => 42_000,
        });

        expect(metrics.recordedActionCount).toBe(42_000);
    });

    it('passes a null count through as null, never as zero', () => {
        // A metric that does not exist is not a metric reading zero: no
        // recording in progress must render as unavailable in the HUD.
        const metrics = readHostMetrics({
            heapUsedBytes: () => 1024 * 1024,
            recordedActionCount: () => null,
        });

        expect(metrics.recordedActionCount).toBeNull();
        expect(metrics.hostHeapMb).toBe(1);
    });
});

describe('startHostMetricsPush', () => {
    it('pushes at ~1 Hz and not per beat', () => {
        // Per beat the push would BE the cost it measures — a 100 ms realtime
        // host would pay an IPC round trip ten times a second to report on
        // itself. This pins the declared rate, not merely that some rate exists.
        const { timers, intervals } = makeTimers();
        startHostMetricsPush(
            { heapUsedBytes: () => 0, recordedActionCount: () => null },
            () => undefined,
            timers,
        );

        expect(HOST_METRICS_PUSH_INTERVAL_MS).toBe(1000);
        expect(intervals).toEqual([HOST_METRICS_PUSH_INTERVAL_MS]);
    });

    it('sends nothing until the first interval elapses', () => {
        const { timers, fire } = makeTimers();
        const send = vi.fn();
        startHostMetricsPush(
            { heapUsedBytes: () => 0, recordedActionCount: () => null },
            send,
            timers,
        );

        expect(send).not.toHaveBeenCalled();

        fire();

        expect(send).toHaveBeenCalledTimes(1);
    });

    it('re-reads its sources on every tick rather than caching a first sample', () => {
        const { timers, fire } = makeTimers();
        const sent: (number | null)[] = [];
        let count: number | null = null;
        startHostMetricsPush(
            { heapUsedBytes: () => 0, recordedActionCount: () => count },
            (metrics) => sent.push(metrics.recordedActionCount),
            timers,
        );

        fire();
        count = 12;
        fire();
        count = 34;
        fire();

        expect(sent).toEqual([null, 12, 34]);
    });

    it('stops pushing once disposed, and disposing twice clears once', () => {
        const { timers, fire, cleared } = makeTimers();
        const send = vi.fn();
        const dispose = startHostMetricsPush(
            { heapUsedBytes: () => 0, recordedActionCount: () => null },
            send,
            timers,
        );

        fire();
        dispose();
        dispose();

        expect(cleared).toHaveLength(1);
        expect(send).toHaveBeenCalledTimes(1);
    });
});
