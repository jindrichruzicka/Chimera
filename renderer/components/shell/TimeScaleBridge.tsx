'use client';

/**
 * renderer/components/shell/TimeScaleBridge.tsx
 *
 * The one-way carrier of authoritative time dilation into the renderer: it takes
 * the snapshot's `timeScalePermille` and seats the matching multiplier in
 * `timeScaleStore`. Renders nothing.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **The permille arrives as a PROP.** `GameShell` already holds the snapshot, so
 * this component reads no store of its own — in particular not `gameStore`,
 * whose public barrel could not be imported here without CONSTRUCTING the game
 * store as a side effect of the module graph. What travels is one integer, in
 * one direction: no animation state is written back (Invariant #131).
 *
 * **No arithmetic here either.** The permille is handed to the store verbatim
 * and `timeScaleStore` derives the float through the one shared multiplier, so
 * the clamp, the fractional-permille refusal and the reciprocal relationship
 * with the host's beat period all have a single definition (Invariant #130).
 *
 * Mounted once, as the first child of `GameShell`'s `AssetManagerContext`
 * provider — inside the single `gameShell` expression both of that component's
 * return paths return, so a game declaring no `eventAudioBinding` mounts it too.
 */

import React from 'react';

import { useTimeScaleStore } from '../../animation/timeScaleStore.js';

export interface TimeScaleBridgeProps {
    /**
     * The authoritative `snapshot.timeScalePermille`. Required but nullable at
     * the type level (`number | undefined` rather than `permille?`), so a caller
     * cannot forget it: the snapshot field is optional and an undilated match
     * legitimately carries nothing.
     */
    readonly permille: number | undefined;
}

export function TimeScaleBridge({ permille }: TimeScaleBridgeProps): null {
    const setAuthoritativePermille = useTimeScaleStore((state) => state.setAuthoritativePermille);

    // An effect, not a render-phase write: seating store state during render
    // would mutate a module singleton other components are already subscribed
    // to, and React may discard a render. Keyed on the permille, so an
    // unchanged snapshot re-render writes nothing.
    //
    // The cleanup returns the store to real time, because the multiplier
    // belongs to a live snapshot and an unmounted bridge has none: a match that
    // ended while dilated would otherwise leave every later clip in the app at
    // that speed — menus and galleries included, since `useClipPlayer` follows
    // this store by default — with nothing able to reset it. It also runs on a
    // permille CHANGE, which costs one extra store write inside the same
    // passive-effect flush and reaches no frame in between.
    React.useEffect(() => {
        setAuthoritativePermille(permille);
        return () => {
            setAuthoritativePermille(undefined);
        };
    }, [setAuthoritativePermille, permille]);

    return null;
}
