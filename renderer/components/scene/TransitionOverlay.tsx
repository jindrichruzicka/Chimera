'use client';

import React from 'react';
import type { PlayerSnapshot } from '@chimera/simulation/bridge/api-types.js';
import { useFade, type FadePhase } from '../shell/FadeContext.js';

export interface TransitionOverlayProps {
    readonly snapshot: PlayerSnapshot;
}

export function TransitionOverlay({ snapshot }: TransitionOverlayProps): React.ReactElement | null {
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
    zIndex: 9999,
};
