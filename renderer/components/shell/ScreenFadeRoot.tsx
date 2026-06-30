'use client';

// renderer/components/shell/ScreenFadeRoot.tsx
//
// Client wrapper that mounts the app-level screen-fade provider + overlay for
// cross-screen route transitions (main-menu ↔ lobby ↔ game). It exists so the
// easing FUNCTION stays inside client code: AppShell is a Server Component, and
// passing `easeInOut` as a prop to the client <FadeProvider> from there is
// illegal during static export ("Functions cannot be passed directly to Client
// Components"). AppShell renders <ScreenFadeRoot>{…}</ScreenFadeRoot> passing
// only children, and the easing is applied here.

import React, { type ReactNode } from 'react';
import { easeInOut } from '../../utils/curves';
import { FadeProvider } from './FadeContext';
import { ScreenFadeOverlay } from './ScreenFadeOverlay';

export function ScreenFadeRoot({ children }: { readonly children: ReactNode }): React.ReactElement {
    return (
        <FadeProvider easing={easeInOut}>
            {children}
            {/* Last child: the overlay's z-index sits above the in-game one. */}
            <ScreenFadeOverlay />
        </FadeProvider>
    );
}
