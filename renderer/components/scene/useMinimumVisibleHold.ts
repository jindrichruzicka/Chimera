// renderer/components/scene/useMinimumVisibleHold.ts
//
// The reusable delayed-release latch behind the minimum-visible loading-cover
// hold (§4.36). The hold duration itself comes from
// `resolveLoadingCoverHoldMs`; this hook only latches.
//
// Timer discipline follows ToastHost: `window.setTimeout` held in a ref,
// cancelled on unmount. JS-driven timing like the screen fades — no `--ch-*`
// CSS duration token is involved (Invariant #109 spirit).

import { useEffect, useRef, useState } from 'react';

/**
 * Latch `shown` so a rise stays visible at least `holdMs` milliseconds.
 *
 * Returns `true` from the moment `shown` rises. A fall before `holdMs` has
 * elapsed since the latest rise keeps returning `true` until the remainder
 * elapses (one timer), then flips `false`; a fall at or past the minimum
 * releases immediately with no timer armed. A re-show during a pending release
 * cancels the release and stamps a fresh show time.
 *
 * A `holdMs` that is not a finite positive number — `0` above all — makes the
 * hook structurally inert: it returns `shown` unchanged and arms no timer at
 * all, so the zero path cannot reorder any existing flush.
 *
 * The remainder is computed from a monotonic `performance.now()` stamp taken
 * at the rise. The setup re-arms every piece of state it owns, so StrictMode's
 * simulated effect remount leaves the latch live (the F83 `mountedRef` lesson:
 * a cleanup-only latch stays dead for the rest of the mount).
 */
export function useMinimumVisibleHold(shown: boolean, holdMs: number): boolean {
    const holdActive = Number.isFinite(holdMs) && holdMs > 0;
    const shownAtRef = useRef<number | null>(null);
    const timerRef = useRef<number | null>(null);
    const [holding, setHolding] = useState(false);

    useEffect(() => {
        if (!holdActive) {
            return;
        }
        if (shown) {
            // The rise — or a re-show mid-release, whose pending timer the
            // falling effect's cleanup below has already cancelled.
            shownAtRef.current = performance.now();
            setHolding(true);
            return;
        }
        if (shownAtRef.current === null) {
            // Never shown: nothing to hold.
            return;
        }
        const remainder = holdMs - (performance.now() - shownAtRef.current);
        if (remainder <= 0) {
            setHolding(false);
            return;
        }
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setHolding(false);
        }, remainder);
        return () => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [shown, holdMs, holdActive]);

    return holdActive ? shown || holding : shown;
}
