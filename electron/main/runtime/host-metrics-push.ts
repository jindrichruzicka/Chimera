// electron/main/runtime/host-metrics-push.ts
//
// The host's own performance metrics, pushed to the renderer on a LOW-RATE
// interval (§4.16).
//
// The Performance HUD's `heapMb` is the RENDERER's `performance.memory`, so a
// host-side buffer can grow to any size with the HUD unchanged. These two
// numbers are the host's: the main process heap, and how many actions the live
// deterministic recording holds.
//
// The rate is the point. Per beat these would BE the cost they measure — a
// realtime host at 100 ms would pay an IPC round trip ten times a second to
// report on itself — so the push runs on its own timer at
// {@link HOST_METRICS_PUSH_INTERVAL_MS} and never on the action path.
//
// Both fields are nullable and `null` means UNAVAILABLE, never zero: no
// recording in progress is a different state from a recording holding no
// actions, and the HUD renders the two differently.

import type { HostPerfMetrics } from '@chimera-engine/simulation/bridge/api-types.js';

/**
 * Interval between host-metric pushes, in milliseconds. 1 Hz: fast enough that
 * a growing buffer is visible while a player watches, slow enough that the
 * measurement is not the cost.
 */
export const HOST_METRICS_PUSH_INTERVAL_MS = 1000;

/** Where each metric is read from. Injected so the reader is testable. */
export interface HostMetricsSources {
    /** Main-process heap in bytes — `process.memoryUsage().heapUsed`. */
    readonly heapUsedBytes: () => number;
    /** Actions in the live deterministic recording, or `null` when none runs. */
    readonly recordedActionCount: () => number | null;
}

/** One sample, in the units the renderer displays. */
export function readHostMetrics(sources: HostMetricsSources): HostPerfMetrics {
    return {
        hostHeapMb: sources.heapUsedBytes() / (1024 * 1024),
        recordedActionCount: sources.recordedActionCount(),
    };
}

/** Timer injection, so a test drives the interval without a wall clock. */
export interface HostMetricsPushTimers {
    readonly setInterval: (handler: () => void, ms: number) => unknown;
    readonly clearInterval: (handle: unknown) => void;
}

/**
 * Start pushing host metrics every {@link HOST_METRICS_PUSH_INTERVAL_MS}.
 *
 * `send` is called with each sample and must not throw — it is invoked from a
 * timer with no caller to catch it. Returns the disposer; calling it twice is
 * harmless.
 *
 * Nothing is pushed on start: the first sample arrives one interval in, so a
 * boot that never opens a window pays nothing.
 */
export function startHostMetricsPush(
    sources: HostMetricsSources,
    send: (metrics: HostPerfMetrics) => void,
    timers: HostMetricsPushTimers = {
        setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
        clearInterval: (handle) => {
            globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
        },
    },
): () => void {
    const handle = timers.setInterval(() => {
        send(readHostMetrics(sources));
    }, HOST_METRICS_PUSH_INTERVAL_MS);

    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;
        timers.clearInterval(handle);
    };
}
