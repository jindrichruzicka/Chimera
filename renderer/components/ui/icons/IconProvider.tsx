'use client';

// renderer/components/ui/icons/IconProvider.tsx
//
// The React binding that publishes a game's contributed glyphs to <Icon> via
// IconContext. Pure and inert by default: mounted with no `gameIcons` it
// publishes `null`, so a no-icon game (or the bare engine shell) renders engine
// icons at zero cost — identical to mounting nothing. It imports NO store and NO
// game module: the store-connected ActiveGameIconProvider resolves the set from
// the registry shell seam and passes it down, mirroring I18nProvider /
// TokenModeI18nProvider.
//
// Surfaced through the public `components/ui` barrel so a game (or its isolated
// tests) can supply a set to a subtree without the store wrapper — the same
// rationale that surfaces EscapeStackProvider.

import React, { type ReactNode, useMemo } from 'react';

import { IconContext } from './icon-context';
import type { GameIconSet } from './registry';

export interface IconProviderProps {
    /**
     * The active game's contributed glyphs. Absent ⇒ the context publishes
     * `null` and `<Icon>` resolves against the engine registry only.
     */
    readonly gameIcons?: GameIconSet;
    readonly children: ReactNode;
}

export function IconProvider({ gameIcons, children }: IconProviderProps): React.ReactElement {
    // Memoize on the set's identity so consumers don't re-render once the load
    // settles (the game set is a stable module const).
    const value = useMemo<GameIconSet | null>(() => gameIcons ?? null, [gameIcons]);
    return <IconContext.Provider value={value}>{children}</IconContext.Provider>;
}
