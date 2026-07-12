// renderer/i18n/i18n-context.ts
//
// The React context that carries the active-locale translation function to
// consumers. This is the thin React seam over the framework-free i18n runtime:
// I18nProvider assembles the bundles and installs a `t` here; useTranslate reads
// it back out. Kept as a plain context module (no `'use client'`, no JSX) so the
// provider and hook can each own their own client boundary, mirroring the theme
// module split (theme-context.ts / ThemeProvider.tsx / useTheme.ts).
//
// Zero cross-layer imports beyond the sibling runtime types: no game module, no
// simulation/ai runtime, no Electron.

import { createContext } from 'react';

import type { MessageParams } from './format-message.js';
import type { TranslationKey } from './translation-bundle.js';

// Re-exported so consumers (hook callers, the provider) can import the params
// type from the same module as the function type it feeds, without reaching
// into format-message.js directly.
export type { MessageParams } from './format-message.js';

/**
 * The stable translation function a component calls to render a UI string.
 * Resolves `key` against the active locale's bundles (game override → engine
 * default → raw key) and formats the result with `params`. Never throws on a
 * well-formed template; an unknown key renders as the raw token.
 */
export type TranslateFn = (key: TranslationKey, params?: MessageParams) => string;

/** The value {@link I18nProvider} publishes and {@link useTranslate}/{@link useI18n} read. */
export interface I18nContextValue {
    /** The effective active locale (BCP-47), after game-default fallback. */
    readonly locale: string;
    /** The stable translation function for {@link locale}. */
    readonly t: TranslateFn;
}

/**
 * Null-default context: a consumer used outside {@link I18nProvider} reads
 * `null`, which the hooks turn into a descriptive throw (Invariant #83).
 */
export const I18nContext = createContext<I18nContextValue | null>(null);
