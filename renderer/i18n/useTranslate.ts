'use client';

// renderer/i18n/useTranslate.ts
//
// Consumer hooks for the i18n runtime. useTranslate() is the ergonomic API a
// component calls to render a UI string; useI18n() also exposes the active
// locale for the few callers (e.g. the LanguageSelector) that need it. Both
// throw a descriptive error when used outside I18nProvider (null-default
// context, Invariant #83), so a missing provider fails loudly at the call site
// rather than silently returning raw tokens.

import { useContext } from 'react';

import { I18nContext, type I18nContextValue, type TranslateFn } from './i18n-context.js';

/**
 * Read the full i18n context (active locale + translation function). Throws
 * when used outside {@link I18nProvider}.
 */
export function useI18n(): I18nContextValue {
    const context = useContext(I18nContext);
    if (context === null) {
        throw new Error('useI18n/useTranslate must be used within I18nProvider');
    }
    return context;
}

/**
 * The stable translation function for the active locale:
 *
 * ```ts
 * const t = useTranslate();
 * t('engine.chat.title' as TranslationKey);          // → 'Chat'
 * t('game.turn.count' as TranslationKey, { n: 3 });  // → 'Turn 3'
 * ```
 *
 * Throws when used outside {@link I18nProvider}.
 */
export function useTranslate(): TranslateFn {
    return useI18n().t;
}
