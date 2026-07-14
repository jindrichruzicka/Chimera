'use client';

// renderer/components/ui/icons/ActiveGameIconProvider.tsx
//
// Store-connected wrapper around the pure <IconProvider>. Resolves the active
// game's contributed glyphs via the registry shell seam (never a direct
// `apps/*` import, Invariants #80/#94/#113) and forwards them to the provider.
// Mounted once high in the tree (AppShell) so every <Icon> — shell chrome and
// game screens alike — can resolve a game glyph. A no-icon game resolves to
// `undefined` ⇒ engine icons only, at zero cost.
//
// Kept as a thin 'use client' wrapper (mirroring TokenModeI18nProvider) so
// AppShell stays a server component: the store/registry reads live here.

import React, { type ReactNode } from 'react';

import { IconProvider } from './IconProvider';
import { useActiveGameIcons } from './useActiveGameIcons';

export interface ActiveGameIconProviderProps {
    readonly children: ReactNode;
}

export function ActiveGameIconProvider({
    children,
}: ActiveGameIconProviderProps): React.ReactElement {
    const gameIcons = useActiveGameIcons();
    return (
        // Spread the set only when present: IconProvider declares `gameIcons`
        // optional and the tree compiles with exactOptionalPropertyTypes.
        <IconProvider {...(gameIcons !== undefined ? { gameIcons } : {})}>{children}</IconProvider>
    );
}
