'use client';

/**
 * Engine frame-rate limiter — caps the R3F render loop to the active game's
 * `settings.display.targetFps`. Mount it once inside a game's <Canvas> (the
 * engine GameCanvas does this for you); games with their own <Canvas> import it
 * from `@chimera-engine/renderer/components/r3f` and mount it like PerfProbe.
 *
 * Why this exists: Chromium presents `requestAnimationFrame` vsync-locked to the
 * display, so an uncapped scene renders at the panel's full refresh (120/144/240
 * Hz), burning GPU and battery for a game that does not need it. There is no
 * runtime API to change vsync, but the render rate can be throttled below it.
 *
 * How it works:
 *  - `targetFps === 0` (uncapped) → render `null`: no takeover, R3F's own
 *    automatic render runs every frame (native refresh).
 *  - `targetFps > 0` → mount CappedRenderLoop, whose `useFrame` runs at
 *    `renderPriority` 1. Any subscriber with a non-zero render priority disables
 *    R3F's automatic render, making that subscriber responsible for calling
 *    `gl.render` — so we render only once the accumulated time reaches the frame
 *    interval, and skip the frame otherwise. Animation `useFrame` callbacks
 *    (priority 0) still tick at native rate; only the GPU present is capped.
 *
 * Rules (mirrors PerfProbe):
 *  - Must be mounted inside a <Canvas> (uses useFrame). Returns null — no DOM.
 *  - No setState in the hot path; all pacing lives in refs.
 *  - Renderer-only: no simulation/, electron/, or ai/ imports (settingsStore is
 *    the renderer's IPC-mirrored store, same source AudioBus reads volumes from).
 */

import { useFrame } from '@react-three/fiber';
import React from 'react';
import type { EngineSettings } from '@chimera-engine/simulation/bridge/api-types.js';
import { useSettingsStore, type SettingsStoreState } from '../../state/settingsStore.js';

/** Fallback settings namespace when no game context is active (mirrors AudioBus). */
const ENGINE_SETTINGS_GAME_ID = '__engine__';

/**
 * Tolerance applied to the frame interval so that when the target equals the
 * display's native refresh (e.g. 60 fps target on a 60 Hz panel) sub-millisecond
 * `requestAnimationFrame` jitter cannot push a frame just under the threshold and
 * halve the effective rate. 1% is far below one frame, so it never overshoots a
 * lower cap on a high-refresh display.
 */
const INTERVAL_TOLERANCE = 0.99;

/** Read the active game's frame-rate cap; `0` (uncapped) when unavailable. */
function selectTargetFps(state: SettingsStoreState): number {
    const active = state.activeGameId === null ? undefined : state.settings[state.activeGameId];
    // Cast so `.display` reads the declared EngineSettings key rather than
    // ResolvedSettings' index signature (ResolvedSettings is index-typed, so a
    // plain annotation is rejected — this mirrors AudioBus reading the store).
    const resolved = (active ?? state.settings[ENGINE_SETTINGS_GAME_ID]) as
        | EngineSettings
        | undefined;
    const targetFps = resolved?.display?.targetFps;
    return typeof targetFps === 'number' ? targetFps : 0;
}

export function FrameRateLimiter(): React.ReactElement | null {
    const targetFps = useSettingsStore(selectTargetFps);

    // Uncapped: no render takeover — R3F's default automatic render runs at the
    // native refresh rate. Remounting on change resets the pacing accumulator.
    if (targetFps <= 0) {
        return null;
    }
    return <CappedRenderLoop key={targetFps} targetFps={targetFps} />;
}

function CappedRenderLoop({ targetFps }: { readonly targetFps: number }): null {
    const intervalSeconds = 1 / targetFps;
    const accumulatorRef = React.useRef(0);

    useFrame((state, deltaSeconds) => {
        accumulatorRef.current += deltaSeconds;
        if (accumulatorRef.current < intervalSeconds * INTERVAL_TOLERANCE) {
            // Not time to present yet — skip this frame's GPU render.
            return;
        }
        // Keep the fractional remainder so the cadence stays smooth on
        // high-refresh displays, but clamp to one interval so a long stall (tab
        // hidden, GC pause) cannot queue a burst of catch-up renders.
        accumulatorRef.current = Math.max(
            0,
            Math.min(accumulatorRef.current - intervalSeconds, intervalSeconds),
        );
        state.gl.render(state.scene, state.camera);
    }, 1);

    return null;
}
