// renderer/components/scene/useCoverExitRamp.ts
//
// The exit ramp a route-entry loading cover leaves on (§4.36). A cover the
// player never saw is dropped the moment its window closes, exactly as before
// this hook existed; a cover the player DID see fades out over the scene that
// is already mounted and rendering beneath it, which costs one fade instead of
// returning through black for two.
//
// Timer discipline follows `useMinimumVisibleHold`: `window.setTimeout` held in
// a ref, cancelled on unmount. The unmount is driven by that timer and never by
// a `transitionend` listener — a Playwright-driven Electron window runs occluded
// and never advances CSS transition clocks, so a listener would strand a cover
// at `--ch-z-loading-hud`, above every modal and toast, for the rest of a match.

import { useEffect, useRef, useState } from 'react';

/** Whether the cover renders at all, and whether it is on its way out. */
export interface CoverExitRamp {
    /** Render the cover while true — the window, plus any ramp that outlives it. */
    readonly mounted: boolean;
    /** Drive the cover's opacity to 0 while true. */
    readonly exiting: boolean;
}

/**
 * Extend a closing cover window by `exitMs` when the cover was visible at any
 * point during it.
 *
 * `up` is the window the caller owns; `visible` is whether the cover was
 * something the player could actually see. Visibility is remembered for the
 * WHOLE window rather than read at its close: a route-entry cover stops being
 * `visible` the moment its gate settles and stays `up` for the minimum-visible
 * remainder, so the last covered render reports a cover nobody saw.
 *
 * `mounted` and `exiting` both turn true on the first render after the window
 * closes — a cover that unmounted for one render and came back would flash, and
 * one that stayed opaque for a render would start its ramp late. Re-opening the
 * window cancels the ramp; each window's visibility is its own.
 *
 * An `exitMs` that is not a finite positive number — `0` above all, which is
 * what `screenFadeMs()` returns under the e2e flag and under reduced motion —
 * makes the hook structurally inert: `mounted` tracks `up`, and no timer is
 * armed at all.
 */
export function useCoverExitRamp(up: boolean, visible: boolean, exitMs: number): CoverExitRamp {
    const rampActive = Number.isFinite(exitMs) && exitMs > 0;
    // Written render-phase — the mirror half is `SceneRouter`'s held-cover
    // pattern — because the render that closes the window can no longer observe
    // what the covered renders before it saw. The state adjustment below is
    // this hook's own: it is what keeps `mounted` from dipping on that render.
    const everVisibleRef = useRef(false);
    const previousUpRef = useRef(up);
    const timerRef = useRef<number | null>(null);
    const [exiting, setExiting] = useState(false);

    if (previousUpRef.current !== up) {
        previousUpRef.current = up;
        if (up) {
            // A new window: its own visibility, and nothing left of the old ramp.
            everVisibleRef.current = false;
            setExiting(false);
        } else if (rampActive && everVisibleRef.current) {
            setExiting(true);
        }
    }
    // No `up &&` guard: every rise clears this, and it is only ever read at a
    // fall, so a write made while the window is closed is erased before it can
    // reach one. The reset is what scopes visibility to a window, not the write.
    if (visible) {
        everVisibleRef.current = true;
    }

    useEffect(() => {
        if (!exiting) {
            return;
        }
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setExiting(false);
        }, exitMs);
        return () => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [exiting, exitMs]);

    return { mounted: up || exiting, exiting };
}
