/**
 * renderer/components/r3f/mainCanvasRegistry.ts
 *
 * Module-level registry of mounted `role="main"` GameCanvas roots (§4.22;
 * §4.16 probe placement). Exactly one main canvas may publish perf metrics:
 * the singleton perfStore's `setPerfFrame` is last-writer-wins, so two mounted
 * probes interleave their numbers in the HUD instead of failing loudly. A
 * second concurrent main is therefore a wiring mistake the engine REPORTS —
 * logged, not thrown, per the FrameloopWiringError conventions
 * (FrameRateLimiter.tsx's header records why a canvas-adjacent failure must
 * not throw).
 *
 * The report is deferred one frame and cancelled when the count returns to
 * ≤1 first: a screen transition may briefly overlap the outgoing main with
 * the incoming one, and only a pair still concurrent when the frame fires is
 * a real duplicate.
 *
 * Not exported from the r3f barrel — GameCanvas is the only production
 * caller.
 */

import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger.js';

/** Log module name, so the report is attributable rather than 'global'. */
const LOG_MODULE = 'game-canvas';

/** Names a tree that mounted more than one `role="main"` GameCanvas. */
class DuplicateMainGameCanvasError extends Error {
    constructor(mainCount: number) {
        super(
            `${mainCount} GameCanvas roots with role="main" are mounted concurrently, so ` +
                `the perf HUD interleaves their metrics. Exactly one canvas is the main ` +
                `one — give every additional canvas (minimap, preview) role="overlay".`,
        );
        this.name = 'DuplicateMainGameCanvasError';
    }
}

let mainCount = 0;
let pendingReportHandle: number | null = null;

/**
 * Claims a main-canvas slot; returns the release for the unmount cleanup.
 * Reports (once, deferred, by name) when more than one slot is claimed at the
 * moment the deferral fires.
 */
export function registerMainCanvas(): () => void {
    mainCount += 1;
    if (mainCount > 1 && pendingReportHandle === null) {
        pendingReportHandle = requestAnimationFrame(() => {
            pendingReportHandle = null;
            emitRendererError(
                readRendererLogsApi(),
                '[GameCanvas] more than one role="main" canvas is mounted',
                new DuplicateMainGameCanvasError(mainCount),
                undefined,
                LOG_MODULE,
            );
        });
    }

    let released = false;
    return () => {
        // React calls a cleanup exactly once, but a double release must not
        // free a second slot — the count would drift and a real duplicate
        // would never report again.
        if (released) {
            return;
        }
        released = true;
        mainCount -= 1;
        if (mainCount <= 1 && pendingReportHandle !== null) {
            cancelAnimationFrame(pendingReportHandle);
            pendingReportHandle = null;
        }
    };
}
