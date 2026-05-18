'use client';

/**
 * renderer/components/shell/perf/PerfProbe.tsx
 *
 * Headless R3F component that collects per-frame GL stats and timing,
 * and writes them to perfStore every 500 ms via setPerfFrame().
 *
 * Architecture reference: §4.16 — Performance HUD
 * Task: issue #582 — Implement PerfProbe.tsx
 *
 * Rules:
 *  - Must be mounted inside a <Canvas> (uses useFrame).
 *  - Returns null — no DOM output.
 *  - Per-frame logic lives in useFrame; no setState inside the hot path (§6.3).
 *  - GL info read from state.gl inside useFrame — fresh each frame, no stale ref.
 *  - Rolling frame-time array capped at 120 entries (§4.16).
 *  - FPS computed by counting frames within the last 1 s of accumulated delta.
 *  - p95 uses nearest-rank: index = ceil(0.95 * n) - 1.
 *  - All elapsed-time tracking is driven by R3F-provided deltaSeconds.
 *  - Publishes to the singleton usePerfStore.getState().setPerfFrame().
 *  - Module boundary: renderer-only; no simulation/, electron/, or ai/ imports.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { usePerfStore } from './perfStore.js';

// Maximum number of frame-time samples retained for avg/p95 calculation.
const FRAME_SAMPLE_CAP = 120;

// Minimum accumulated ms between store publishes.
const PUBLISH_INTERVAL_MS = 500;

// Rolling window for FPS calculation (ms).
const FPS_WINDOW_MS = 1000;

/**
 * Compute nearest-rank 95th-percentile from a sorted-ascending array.
 * Returns 0 for empty input.
 */
function p95SortedAsc(sorted: readonly number[]): number {
    const n = sorted.length;
    if (n === 0) return 0;
    const idx = Math.min(Math.ceil(0.95 * n) - 1, n - 1);
    return sorted[idx] ?? 0;
}

/**
 * Compute mean of a numeric array. Returns 0 for empty input.
 */
function mean(values: readonly number[]): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

export function PerfProbe(): null {
    // Accumulated elapsed time (ms) since component mounted.
    const accTimeRef = useRef<number>(0);

    // ms accumulated since the last publish (starts at 0 — first publish after 500 ms).
    const msSincePublishRef = useRef<number>(0);

    // Frame-time ring buffer used for frameMsAvg / frameMsP95 only.
    const frameDeltasRef = useRef<number[]>([]);

    // Rolling one-second frame timestamps used for FPS only.
    const fpsFrameTimesRef = useRef<number[]>([]);

    useFrame((state, deltaSeconds) => {
        const deltaMs = deltaSeconds * 1000;
        accTimeRef.current += deltaMs;
        msSincePublishRef.current += deltaMs;

        const accTime = accTimeRef.current;

        // Append this frame's timing sample.
        frameDeltasRef.current.push(deltaMs);

        // Evict samples beyond the rolling frame cap.
        if (frameDeltasRef.current.length > FRAME_SAMPLE_CAP) {
            frameDeltasRef.current = frameDeltasRef.current.slice(
                frameDeltasRef.current.length - FRAME_SAMPLE_CAP,
            );
        }

        fpsFrameTimesRef.current.push(accTime);
        const fpsWindowStart = accTime - FPS_WINDOW_MS;
        let firstFrameInWindow = 0;
        while (
            firstFrameInWindow < fpsFrameTimesRef.current.length &&
            (fpsFrameTimesRef.current[firstFrameInWindow] ?? 0) <= fpsWindowStart
        ) {
            firstFrameInWindow++;
        }
        if (firstFrameInWindow > 0) {
            fpsFrameTimesRef.current = fpsFrameTimesRef.current.slice(firstFrameInWindow);
        }

        // Throttle: only publish every PUBLISH_INTERVAL_MS.
        if (msSincePublishRef.current < PUBLISH_INTERVAL_MS) return;
        msSincePublishRef.current = 0;

        const deltas = frameDeltasRef.current;
        const sorted = deltas.slice().sort((a, b) => a - b);

        // Read GL info from the frame state (fresh each frame, no stale ref).
        const info = state.gl.info.render;

        usePerfStore.getState().setPerfFrame({
            fps: fpsFrameTimesRef.current.length,
            frameMsAvg: mean(deltas),
            frameMsP95: p95SortedAsc(sorted),
            drawCalls: info.calls,
            triangles: info.triangles,
        });
    });

    return null;
}
