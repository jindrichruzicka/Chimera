// renderer/components/scene/useRouteCoverRevealGrace.ts
//
// The grace before a route-entry loading cover is revealed to the player
// (§4.36). A route enters under an opaque screen-fade scrim, so the cover it
// mounts is present but unseen; this hook decides when the wait has run long
// enough that showing it is worth clearing the scrim for.
//
// The duration comes from `ROUTE_COVER_REVEAL_GRACE_MS`; this hook only times.
// Deliberately a threshold on a wait rather than a delay added to one: a wait
// that settles first pays nothing, so the fast entry keeps its single fade-in.
//
// Timer discipline follows `useMinimumVisibleHold`: `window.setTimeout` held in
// a ref, cancelled on unmount. The timer reads nothing but the clock — no gate,
// no progress, no asset state — so it fires whatever the preload does, which is
// what keeps a slow, missing or undeclared asset from stranding a route on
// black (Invariant #133).

import { useEffect, useRef, useState } from 'react';

/**
 * Whether the route should clear its entry scrim so the cover it has already
 * mounted becomes visible: `true` once `waiting` has been continuously true for
 * `graceMs` milliseconds.
 *
 * Falls back to `false` when the wait ends, granted or not, so a second wait in
 * the same mount is timed from its own start rather than inheriting the first
 * one's elapsed time.
 *
 * A `graceMs` that is not a finite positive number — `0` above all — makes the
 * hook structurally inert: it returns `waiting` unchanged and arms no timer at
 * all, so the zero path cannot reorder any existing flush.
 *
 * Unlike `useMinimumVisibleHold` this keeps no monotonic stamp and carries no
 * remainder: every re-arm times a full `graceMs` from that moment. The setup
 * arms the timer its own cleanup cleared, which is what keeps the latch live
 * across StrictMode's simulated effect remount (the F83 `mountedRef` lesson: a
 * cleanup-only latch stays dead for the rest of the mount); that remount runs
 * cleanup and setup in one commit, so re-arming from scratch costs nothing.
 */
export function useRouteCoverRevealGrace(waiting: boolean, graceMs: number): boolean {
    const graceActive = Number.isFinite(graceMs) && graceMs > 0;
    const timerRef = useRef<number | null>(null);
    const [requested, setRequested] = useState(false);

    useEffect(() => {
        if (!graceActive) {
            return;
        }
        if (!waiting) {
            // The wait ended — settled, superseded, or left. The next one is a
            // new wait and gets its own full grace.
            setRequested(false);
            return;
        }
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setRequested(true);
        }, graceMs);
        return () => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [waiting, graceMs, graceActive]);

    return graceActive ? requested : waiting;
}
