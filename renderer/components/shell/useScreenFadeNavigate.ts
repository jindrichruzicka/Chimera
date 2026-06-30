'use client';

// renderer/components/shell/useScreenFadeNavigate.ts
//
// Shared helper for the cross-screen route transitions: fade the app-level
// overlay out to black, then run the navigation. The destination screen fades
// itself back in on mount/ready, so callers only own the fade-out half.
//
// Only use this when navigating toward a screen that fades back in (main-menu,
// lobby, game). Navigating to a screen with no fade-in (settings/saves/replays)
// would otherwise leave the overlay stuck black.

import { useCallback, useRef } from 'react';
import { useOptionalFade } from './FadeContext.js';
import { screenFadeMs } from './screenFadeDuration.js';

export function useScreenFadeNavigate(): (navigate: () => void) => Promise<void> {
    const fade = useOptionalFade();
    // Keep the latest FadeControl in a ref so the returned callback is stable
    // and never re-binds on the per-frame opacity changes (cf. useFadeTransition).
    const fadeRef = useRef(fade);
    fadeRef.current = fade;

    return useCallback(async (navigate: () => void): Promise<void> => {
        const control = fadeRef.current;
        if (control === null) {
            navigate();
            return;
        }
        await control.fadeOut(screenFadeMs());
        navigate();
    }, []);
}
