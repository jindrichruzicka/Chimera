'use client';

import React from 'react';
import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import { useFade, type FadePhase } from '../shell/FadeContext.js';

export interface TransitionOverlayProps {
    readonly snapshot: PlayerSnapshot;
    /**
     * Fraction in `[0, 1]` of the entering scene's declared required assets that
     * have settled. Absent when no measured preload is running — the same two
     * states, spelled the same way, as the game-facing contract this mirrors:
     * `SceneRouter` feeds both slots from one withheld-or-passed value.
     *
     * Never `0` as a stand-in for "unmeasured": `0` here means 0 of N refs
     * settled. See the identically-named field on the game-facing
     * `TransitionOverlayProps` contract.
     */
    readonly preloadProgress?: number;
}

export function TransitionOverlay({
    snapshot,
    preloadProgress,
}: TransitionOverlayProps): React.ReactElement | null {
    const fade = useFade();
    const transition = snapshot.sceneTransition;
    // Mounted for as long as the curtain is UP, not only while a transition is
    // in flight. The two are not the same span: the transition ends at the
    // host's commit, but the reveal is deferred past it while a loading cover
    // serves its minimum (§4.36). Unmounting at the commit left this
    // provider's opacity with no painter at all — the fade-in that follows had
    // nothing to animate, so the scene arrived by a hard cut, and the black a
    // player saw during the hold was whatever the cover itself painted.
    if ((transition === undefined || transition === null) && fade.opacity <= 0) {
        return null;
    }

    // With no transition left to describe, the fade's own phase IS the phase:
    // the curtain is holding or easing off under nobody's transition.
    const displayedPhase =
        transition === undefined || transition === null
            ? fade.phase
            : resolveDisplayedFadePhase(transition.phase, fade.phase);

    return (
        <div
            data-testid="transition-overlay"
            data-fade-phase={displayedPhase}
            aria-hidden="true"
            // Handed the raw value, never stringified and never defaulted:
            // React omits an attribute whose value is `undefined`, so an
            // unmeasured wait leaves the element byte-identical to what it was
            // before this prop existed. `String(...)` would print the word
            // "undefined", and `?? 0` would draw an empty bar as a claim nobody
            // measured.
            data-preload-progress={preloadProgress}
            style={{ ...transitionOverlayStyle, opacity: fade.opacity }}
        />
    );
}

function resolveDisplayedFadePhase(
    transitionPhase: NonNullable<PlayerSnapshot['sceneTransition']>['phase'],
    fadePhase: FadePhase,
): FadePhase {
    if (transitionPhase === 'preparing' && fadePhase === 'idle') {
        return 'fade-out';
    }
    if (transitionPhase === 'committing' && fadePhase === 'idle') {
        return 'hold';
    }
    return fadePhase;
}

const transitionOverlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    // The same black the app-level curtain paints. A translucent grey let
    // the outgoing scene show through the hold, so a loading cover above it
    // was never the only thing on screen — which is what the beat exists to
    // make true on this surface too.
    backgroundColor: 'var(--ch-color-scrim)',
    zIndex: 'var(--ch-z-scene-fade)',
};
