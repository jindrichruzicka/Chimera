// renderer/components/ui/icons/icon-context.ts
//
// The React context that carries the active game's contributed icon glyphs to
// <Icon>. Kept as a plain context module (no `'use client'`, no JSX) so the
// provider owns its own client boundary, mirroring the i18n / theme module
// splits (i18n-context.ts / I18nProvider.tsx, theme-context.ts / ThemeProvider).
//
// Null-default (Invariant #83): a bare <Icon> with no provider reads `null` and
// resolves against the engine ICON_REGISTRY only. Unlike the i18n hooks, there
// is deliberately NO throwing consumer hook — rendering <Icon> without an
// IconProvider is a first-class supported case (the component gallery, unit
// tests, the engine-only shell), so <Icon> degrades to the engine registry
// rather than throwing.

import { createContext } from 'react';

import type { GameIconSet } from './registry';

/**
 * The active game's contributed glyphs, or `null` when no {@link IconProvider}
 * is mounted (or the active game contributes none) ⇒ engine icons only.
 */
export const IconContext = createContext<GameIconSet | null>(null);
