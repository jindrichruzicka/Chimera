'use client';

/**
 * Engine frame-rate limiter — paces the R3F render loop to the active game's
 * `settings.display.targetFps`. Mounted once per canvas: games rendering through
 * the engine <GameCanvas> (r3f barrel) get it automatically; a game with its own
 * <Canvas> imports it from `@chimera-engine/renderer/components/r3f` and mounts
 * it like PerfProbe. Never mount it twice in one canvas: each instance owns its
 * own `requestAnimationFrame` chain, so two of them advance the canvas at
 * roughly double the target rate.
 *
 * Why this exists: Chromium presents `requestAnimationFrame` vsync-locked to the
 * display, so an uncapped scene renders at the panel's full refresh (120/144/240
 * Hz), burning GPU and battery for a game that does not need it. There is no
 * runtime API to change vsync, but the render rate can be throttled below it.
 *
 * How it works — this component PACES the loop, it never presents a frame:
 *  - It drives only a canvas whose `frameloop` is `'never'`, i.e. one that has
 *    stopped driving R3F's own `requestAnimationFrame` chain and renders nothing
 *    until something calls `advance()`. `GameCanvas` computes that prop with
 *    `useEngineFrameloop()`, so on the engine canvas both halves read one cap
 *    (see `selectTargetFps.ts`); a game that owns its `<Canvas>` must wire both
 *    itself. Under any other `frameloop`, and at `targetFps === 0`, this
 *    component is inert: no chain, no advance, R3F's default loop untouched.
 *  - When it does drive, it owns that one chain: on every native frame it
 *    accumulates elapsed time and calls the store-bound `advance()` only once
 *    the frame interval is reached. Whoever presents — R3F's own automatic
 *    render, or any third-party pass mounted in the canvas — then runs only on
 *    those frames.
 *
 * Why it must not present: R3F's `internal.priority` is a COUNTER, not a lock —
 * `subscribe` does `priority + (p > 0 ? 1 : 0)`, and `update()` suppresses only
 * R3F's own automatic render while calling every subscriber unconditionally. A
 * `useFrame(cb, 1)` limiter is therefore just one co-presenter among however
 * many the game mounts — any `useFrame(cb, priority > 0)` subscriber becomes
 * one — and none of them can suppress the others. Pacing the loop caps every
 * presenter at once, including ones the engine has never heard of.
 *
 * Rules (mirrors PerfProbe):
 *  - Must be mounted inside a <Canvas> (uses useThree). Returns null — no DOM.
 *  - No setState in the hot path; pacing state lives in the effect closure, so a
 *    `targetFps` change restarts the cadence with a clean accumulator.
 *  - Renderer-only: no simulation/, electron/, or ai/ imports (settingsStore is
 *    the renderer's IPC-mirrored store, same source AudioBus reads volumes from).
 */

import { useThree } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import React from 'react';
import { useSettingsStore } from '../../state/settingsStore.js';
import { selectTargetFps } from './selectTargetFps.js';

/**
 * Tolerance applied to the frame interval so that when the target equals the
 * display's native refresh (e.g. 60 fps target on a 60 Hz panel) sub-millisecond
 * `requestAnimationFrame` jitter cannot push a frame just under the threshold and
 * halve the effective rate. 1% is far below one frame, so it never overshoots a
 * lower cap on a high-refresh display.
 */
const INTERVAL_TOLERANCE = 0.99;

/**
 * The store-bound `advance`, which advances only THIS canvas root. The
 * module-level `advance` export iterates every root in `_roots` and would drive
 * every canvas in the app from this one chain.
 */
function selectAdvance(state: RootState): RootState['advance'] {
    return state.advance;
}

function selectFrameloop(state: RootState): RootState['frameloop'] {
    return state.frameloop;
}

function selectClock(state: RootState): RootState['clock'] {
    return state.clock;
}

export function FrameRateLimiter(): null {
    const targetFps = useSettingsStore(selectTargetFps);
    const advance = useThree(selectAdvance);
    const frameloop = useThree(selectFrameloop);
    const clock = useThree(selectClock);

    // Only a canvas that has surrendered its loop can be paced. Under 'always'
    // or 'demand' R3F still drives its own chain, so a second one would double
    // the work and cap nothing.
    const paced = targetFps > 0 && frameloop === 'never';

    // Layout phase, not passive: under 'never' the canvas shows nothing at all
    // until the first advance, so the eager frame below must land before paint.
    React.useLayoutEffect(() => {
        if (!paced) {
            return;
        }

        const intervalSeconds = 1 / targetFps;
        // R3F's clock is the timestamp origin. Under 'never', `update()` computes
        // `delta = timestamp - clock.elapsedTime`, so resuming from the clock's
        // CURRENT reading is a zero delta whenever this effect starts, however it
        // was restarted. Restarting from 0 unconditionally would hand every
        // consumer a delta of minus the whole elapsed session on any restart
        // that did not also zero the clock.
        const originSeconds = clock.elapsedTime;
        let handle = 0;
        let startTimestamp: number | null = null;
        let lastTimestamp = 0;
        let accumulator = 0;

        // Nothing is on screen until the first advance, so present one frame
        // immediately — at the clock's own reading, which is a zero delta and
        // therefore jumps no tween.
        advance(originSeconds);

        const step = (timestamp: number): void => {
            handle = requestAnimationFrame(step);

            if (startTimestamp === null) {
                // First callback only establishes the timestamp baseline: rAF
                // timestamps are the sole clock here, so there is no earlier
                // reading to measure this frame's delta against. The eager
                // advance above already covered this frame.
                startTimestamp = timestamp;
                lastTimestamp = timestamp;
                return;
            }

            accumulator += (timestamp - lastTimestamp) / 1000;
            lastTimestamp = timestamp;
            if (accumulator < intervalSeconds * INTERVAL_TOLERANCE) {
                return; // not time to advance yet — skip this native frame
            }

            // Keep the fractional remainder so the cadence stays smooth on
            // high-refresh displays, but clamp to one interval so a long stall
            // (tab hidden, GC pause) cannot queue a burst of catch-up frames.
            accumulator = Math.max(0, Math.min(accumulator - intervalSeconds, intervalSeconds));
            // Seconds relative to the R3F clock, never raw milliseconds, and
            // continuing from `originSeconds` so the sequence stays monotonic
            // across an effect restart.
            advance(originSeconds + (timestamp - startTimestamp) / 1000);
        };

        handle = requestAnimationFrame(step);

        return () => {
            cancelAnimationFrame(handle);
        };
    }, [paced, targetFps, advance, clock]);

    return null;
}
