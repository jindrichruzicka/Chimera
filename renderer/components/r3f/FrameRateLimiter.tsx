'use client';

/**
 * Engine frame-rate limiter — paces the R3F render loop to the active game's
 * `settings.display.targetFps`.
 *
 * It is HALF of the cap, and both halves are required. <GameCanvas> wires both
 * itself: this driver inside the canvas and `frameloop={useEngineFrameloop()}`
 * on the root. Neither half is public — the r3f barrel header (index.ts)
 * records the surface rationale.
 *
 * `useEngineFrameloop()` is Canvas-FREE and is called OUTSIDE the canvas whose
 * prop it computes. Mount this component once per canvas: each instance owns its
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
 *    `useEngineFrameloop()`, so both halves read one cap (see
 *    `selectTargetFps.ts`). Under any other `frameloop`, and at
 *    `targetFps === 0`, this component is inert: no chain, no advance, R3F's
 *    default loop untouched.
 *  - When it does drive, it owns that one chain: on every native frame it
 *    accumulates elapsed time and calls the store-bound `advance()` only once
 *    the frame interval is reached. Whoever presents — R3F's own automatic
 *    render, or any third-party pass mounted in the canvas — then runs only on
 *    those frames.
 *
 * The two halves, and what happens when only one is wired:
 *  - Driver mounted, cap set, `frameloop` NOT `'never'` → detectable from here,
 *    and reported as a named `FrameloopWiringError` through the renderer logger.
 *    It is LOGGED, not thrown: this direction degrades to an uncapped loop — the
 *    behaviour before any cap existed — and R3F's `ErrorBoundary` re-throws
 *    OUTWARD past the `<Canvas>`, so a throw here takes down the surrounding
 *    tree, not just the canvas.
 *    Invariant #83's throwing precedent covers engine context hooks, where the
 *    alternative is a silently wrong value rather than a working-but-
 *    unthrottled loop.
 *  - `frameloop: 'never'` with NO driver mounted → a permanently black canvas,
 *    and not detected. This module cannot observe it — nothing of it is mounted
 *    — and neither can a registration check from `useEngineFrameloop`: R3F
 *    renders canvas children into a separate reconciler root, from CanvasImpl's
 *    own layout effect after `configure()` resolves, so the driver's mount is
 *    not observable from a same-commit effect outside the canvas. A
 *    frame-counting watchdog cannot tell a missing driver from a legitimately
 *    paused canvas either — a backgrounded window advances no frames — so it
 *    would fire on every minimised game. Documented, not guessed at.
 *
 * Why it must not present: R3F's `internal.priority` is a COUNTER, not a lock —
 * `subscribe` does `internal.priority = internal.priority + (priority > 0 ? 1 : 0)`,
 * and `update()` suppresses only
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
import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger.js';
import { useSettingsStore } from '../../state/settingsStore.js';
import { selectTargetFps } from './selectTargetFps.js';

/** Log module name, so the report is attributable rather than 'global'. */
const LOG_MODULE = 'frame-rate-limiter';

/** Names a canvas wired with only one half of the cap; see the header. */
class FrameloopWiringError extends Error {
    constructor(targetFps: number, frameloop: string) {
        super(
            `A ${targetFps} fps cap cannot take effect: <FrameRateLimiter /> is mounted in a ` +
                `canvas whose frameloop is '${frameloop}'. <GameCanvas> wires both halves ` +
                `of the cap — the frameloop prop and this driver — itself, so a capped ` +
                `canvas in this state is an engine wiring defect, not a game integration ` +
                `step.`,
        );
        this.name = 'FrameloopWiringError';
    }
}

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

    React.useEffect(() => {
        if (targetFps <= 0 || frameloop === 'never') {
            return;
        }
        // Deferred a frame, and cancelled if the pair resolves first. The cap
        // and the <Canvas frameloop> prop reach their consumers through two
        // different React roots — R3F renders canvas children in its own
        // reconciler — so a correctly wired canvas is briefly mismatched on
        // every cap change, the boot hydration from 0 to the default included.
        // The deferral costs one frame per change, never per frame, and it also
        // collapses StrictMode's mount-unmount-mount into a single report.
        const handle = requestAnimationFrame(() => {
            emitRendererError(
                readRendererLogsApi(),
                '[FrameRateLimiter] frame-rate cap is not wired to the canvas frameloop',
                new FrameloopWiringError(targetFps, frameloop),
                undefined,
                LOG_MODULE,
            );
        });
        return () => {
            cancelAnimationFrame(handle);
        };
    }, [targetFps, frameloop]);

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
