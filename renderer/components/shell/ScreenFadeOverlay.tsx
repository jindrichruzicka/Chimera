'use client';

// App-level full-screen fade overlay for cross-screen route transitions
// (main-menu ↔ lobby ↔ game). Always mounted at the app shell, it reads the
// app-level FadeProvider and renders a black scrim whose alpha is the current
// fade opacity. Distinct from the in-game `TransitionOverlay` (which lives
// inside GameShell and only covers scene-to-scene swaps); this one sits just
// above it so it covers every screen, including the menu and lobby routes.

import React from 'react';
import { useFade } from './FadeContext.js';

export function ScreenFadeOverlay(): React.ReactElement {
    const { opacity } = useFade();

    return (
        <div
            data-testid="screen-fade-overlay"
            aria-hidden="true"
            style={{ ...screenFadeOverlayStyle, opacity }}
        />
    );
}

const screenFadeOverlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    // Solid black scrim; the alpha fade comes from the animated `opacity` above.
    // (--ch-color-surface-overlay, the in-game overlay's colour, is dark-grey
    // #27272a — too light for a true fade-to-black, hence the dedicated token.)
    backgroundColor: 'var(--ch-color-scrim)',
    // Just above the in-game TransitionOverlay (z-index 9999) so a route fade
    // covers the game scene's own fade as well.
    zIndex: 10000,
};
