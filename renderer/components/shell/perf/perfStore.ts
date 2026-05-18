/**
 * renderer/components/shell/perf/perfStore.ts
 *
 * Zustand store for the Performance HUD (§4.16).
 *
 * Holds a rolling PerfSample snapshot consumed by PerfHud and written by:
 *  - PerfProbe (GL/frame metrics via setPerfFrame)
 *  - bootstrapPerfStore (tick, ping, heap via setSimTick, setPingMs, sampleHeap)
 *  - Action dispatch system (via recordActionDispatched)
 *  - Snapshot receiver (via recordSnapshotReceived)
 *
 * Architecture reference: §4.16 — Performance HUD; §5.5 (store mutation ownership)
 * Task: issue #581 — Implement perfStore.ts
 *
 * Module boundary rules:
 *  - Must NOT import from simulation/, electron/, ai/, or games/*.
 *  - Renderer reads state; never writes simulation state directly (Invariant #4).
 *  - Store mutation methods (setSimTick, setPingMs, etc.) are called by bootstrap
 *    wiring only; components read via narrow selectors and call toggle/setVisible.
 *  - Public static accessors: getState (bootstrap read), subscribe (reactive binding).
 *    setState is not exposed (§5.5: no bypass of typed action interface).
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The live performance snapshot displayed by PerfHud.
 * All ten fields defined in §4.16.
 */
export interface PerfSample {
    /** Frames per second; rolling 1 s window computed by PerfProbe. */
    readonly fps: number;
    /** Average frame time in ms over the last 120 frames. */
    readonly frameMsAvg: number;
    /** 95th-percentile frame time in ms over the last 120 frames. */
    readonly frameMsP95: number;
    /** Latest authoritative sim tick from gameStore. */
    readonly simTick: number;
    /** Authoritative snapshots received per second (rolling 1 s count). */
    readonly actionsPerSec: number;
    /** Own-action dispatch → matching snapshot RTT in ms; null until measured. */
    readonly actionRoundTripMs: number | null;
    /** WebSocket PING/PONG round-trip in ms; null when disconnected. */
    readonly pingMs: number | null;
    /** Renderer heap usage in MB; null outside Chromium / when unavailable. */
    readonly heapMb: number | null;
    /** R3F draw calls from gl.info.render.calls. */
    readonly drawCalls: number;
    /** R3F triangle count from gl.info.render.triangles. */
    readonly triangles: number;
}

/**
 * Subset of PerfSample written by PerfProbe via setPerfFrame().
 * These are the GL + frame-time metrics that only the R3F useFrame loop knows.
 */
export interface PerfFrameSample {
    readonly fps: number;
    readonly frameMsAvg: number;
    readonly frameMsP95: number;
    readonly drawCalls: number;
    readonly triangles: number;
}

// ── Store state shape ─────────────────────────────────────────────────────────

export interface PerfStoreState {
    /** Latest performance snapshot; all fields zero / null until populated. */
    readonly sample: PerfSample;
    /** Whether the HUD panel is visible. Toggled by F3 or setVisible(). */
    readonly visible: boolean;

    // ── Actions ───────────────────────────────────────────────────────────────

    /** Toggle HUD visibility. */
    toggle(): void;
    /** Set HUD visibility to an explicit boolean value. */
    setVisible(visible: boolean): void;

    /**
     * Called by PerfProbe (R3F useFrame) each update interval.
     * Updates GL stats and frame-time metrics only.
     */
    setPerfFrame(frame: PerfFrameSample): void;

    /**
     * Update the latest authoritative sim tick.
     * Called by bootstrapPerfStore (not by components) when gameStore.currentTick changes.
     * @internal
     */
    setSimTick(tick: number): void;

    /**
     * Update the network ping latency. Pass null to clear on disconnect.
     * Called by bootstrapPerfStore (not by components) on gameStore.latencyMs changes.
     * @internal
     */
    setPingMs(pingMs: number | null): void;

    /**
     * Record the timestamp when a local action was dispatched.
     * Used to compute actionRoundTripMs when the matching snapshot arrives.
     * Called by the action dispatch system (not by components).
     * @internal
     */
    recordActionDispatched(stamp: number): void;

    /**
     * Record the arrival of an authoritative snapshot. Updates actionsPerSec
     * (rolling 1 s count) and computes actionRoundTripMs from the oldest
     * pending dispatch stamp, if any.
     * Called by the snapshot receiver (not by components).
     * @internal
     */
    recordSnapshotReceived(tick: number, stamp: number): void;

    /**
     * Sample performance.memory.usedJSHeapSize (Chromium only).
     * Returns heapMb = null when unavailable.
     * Called by bootstrapPerfStore (not by components) on a periodic interval.
     * @internal
     */
    sampleHeap(): void;
}

// ── Rolling-window helpers ────────────────────────────────────────────────────

const ROLLING_WINDOW_MS = 1000;

/** Prune entries from a sorted-ascending timestamp array outside the window. */
function pruneStale(stamps: readonly number[], nowMs: number): number[] {
    const cutoff = nowMs - ROLLING_WINDOW_MS;
    let i = 0;
    while (i < stamps.length && (stamps[i] ?? 0) < cutoff) {
        i++;
    }
    return i === 0 ? (stamps as number[]).slice() : (stamps as number[]).slice(i);
}

// ── Heap helper ───────────────────────────────────────────────────────────────

function readHeapMb(): number | null {
    const mem = (performance as unknown as Record<string, unknown>)['memory'] as
        | { usedJSHeapSize: number }
        | undefined;
    if (mem === undefined || typeof mem.usedJSHeapSize !== 'number') {
        return null;
    }
    return mem.usedJSHeapSize / (1024 * 1024);
}

// ── Factory ───────────────────────────────────────────────────────────────────

const INITIAL_SAMPLE: PerfSample = {
    fps: 0,
    frameMsAvg: 0,
    frameMsP95: 0,
    simTick: 0,
    actionsPerSec: 0,
    actionRoundTripMs: null,
    pingMs: null,
    heapMb: null,
    drawCalls: 0,
    triangles: 0,
};

/**
 * Create an isolated perfStore instance.
 * Production code uses the singleton `usePerfStore`; tests use this factory.
 */
export function createPerfStore(): StoreApi<PerfStoreState> {
    // Closed-over mutable state for rolling bookkeeping.
    // These never appear in the Zustand state object — they are internal
    // implementation details that do not need to trigger re-renders.
    let pendingDispatchStamps: number[] = []; // sorted ascending
    let snapshotArrivalStamps: number[] = []; // sorted ascending, within 1 s window

    return createStore<PerfStoreState>()((set, get) => ({
        sample: { ...INITIAL_SAMPLE },
        visible: false,

        toggle(): void {
            set((state) => ({ visible: !state.visible }));
        },

        setVisible(visible: boolean): void {
            set(() => ({ visible }));
        },

        setPerfFrame(frame: PerfFrameSample): void {
            set((state) => ({
                sample: {
                    ...state.sample,
                    fps: frame.fps,
                    frameMsAvg: frame.frameMsAvg,
                    frameMsP95: frame.frameMsP95,
                    drawCalls: frame.drawCalls,
                    triangles: frame.triangles,
                },
            }));
        },

        setSimTick(tick: number): void {
            set((state) => ({
                sample: { ...state.sample, simTick: tick },
            }));
        },

        setPingMs(pingMs: number | null): void {
            set((state) => ({
                sample: { ...state.sample, pingMs },
            }));
        },

        recordActionDispatched(stamp: number): void {
            pendingDispatchStamps = [...pendingDispatchStamps, stamp];
        },

        recordSnapshotReceived(_tick: number, stamp: number): void {
            const nowMs = performance.now();

            // --- actionsPerSec rolling count ---
            snapshotArrivalStamps = pruneStale([...snapshotArrivalStamps, stamp], nowMs);
            const actionsPerSec = snapshotArrivalStamps.length;

            // --- actionRoundTripMs ---
            let actionRoundTripMs = get().sample.actionRoundTripMs;
            if (pendingDispatchStamps.length > 0) {
                const oldest = pendingDispatchStamps[0] ?? stamp;
                actionRoundTripMs = Math.max(0, stamp - oldest);
                // Evict consumed stamp
                pendingDispatchStamps = pendingDispatchStamps.slice(1);
            }

            set((state) => ({
                sample: {
                    ...state.sample,
                    actionsPerSec,
                    actionRoundTripMs,
                },
            }));
        },

        sampleHeap(): void {
            const heapMb = readHeapMb();
            set((state) => ({
                sample: { ...state.sample, heapMb },
            }));
        },
    }));
}

// ── Singleton store ───────────────────────────────────────────────────────────

const perfStoreInstance = createPerfStore();

/**
 * Zustand hook for the perf store.
 *
 * Always subscribe via a narrow selector (§5.2):
 *
 * ```typescript
 * // ✅ Narrow selector — component only re-renders when fps changes
 * const fps = usePerfStore((s) => s.sample.fps);
 *
 * // ❌ Wrong — subscribes to entire store, causes spurious re-renders
 * const store = usePerfStore();
 * ```
 *
 * Static accessors (for bootstrap wiring only):
 *  - `usePerfStore.getState()` — read current state in synchronous context
 *  - `usePerfStore.subscribe()` — attach a reactive listener without React
 *
 * Note: setState is not exposed (§5.5 store mutation ownership). All writes go
 * through typed action methods (setSimTick, setPingMs, etc.) called by bootstrap
 * or internal systems, never by components.
 */
export function usePerfStore<T>(selector: (state: PerfStoreState) => T): T {
    return useStore(perfStoreInstance, selector);
}

// Expose static accessors for bootstrap wiring and tests.
// Only getState and subscribe are needed; setState is deliberately omitted (§5.5).
usePerfStore.getState = perfStoreInstance.getState.bind(perfStoreInstance);
usePerfStore.subscribe = perfStoreInstance.subscribe.bind(perfStoreInstance);
