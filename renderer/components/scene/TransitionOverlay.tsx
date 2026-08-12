'use client';

import React from 'react';
import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import { useFade, type FadePhase } from '../shell/FadeContext.js';

export interface TransitionOverlayProps {
    readonly snapshot: PlayerSnapshot;
    /**
     * Fraction in `[0, 1]` of the entering scene's declared required assets that
     * have settled. Absent — and `null` is treated identically — when no
     * measured preload is running.
     *
     * Never `0` as a stand-in for "unmeasured": `0` here means 0 of N refs
     * settled. See the identically-named field on the game-facing
     * `TransitionOverlayProps` contract.
     */
    readonly preloadProgress?: number | null;
}

export function TransitionOverlay({
    snapshot,
    preloadProgress,
}: TransitionOverlayProps): React.ReactElement | null {
    const fade = useFade();
    const transition = snapshot.sceneTransition;
    if (transition === undefined || transition === null) {
        return null;
    }

    const displayedPhase = resolveDisplayedFadePhase(transition.phase, fade.phase);

    return (
        <div
            data-testid="transition-overlay"
            data-fade-phase={displayedPhase}
            aria-hidden="true"
            // Handed the raw value, never stringified and never defaulted:
            // React omits an attribute whose value is `null`/`undefined`, so an
            // unmeasured wait leaves the element byte-identical to what it was
            // before this prop existed. `String(...)` would print the word
            // "null", and `?? 0` would draw an empty bar as a claim nobody
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
    backgroundColor: 'var(--ch-color-surface-overlay)',
    zIndex: 'var(--ch-z-scene-fade)',
};
