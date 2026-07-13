'use client';

// renderer/i18n/I18nProvider.tsx
//
// The React binding for the opt-in i18n runtime (F71). Mounts once high in the
// renderer tree and publishes a stable `t` to every consumer via useTranslate.
// It is the single place that (a) resolves the effective active locale from the
// persisted choice + the game's declared languages, (b) merges the engine base
// bundle with the game's contributed override for that locale, and (c) exposes
// the debug token-mode flag through `t`.
//
// Inputs arrive as props with inert-by-default values, so a single-language /
// no-i18n game renders `<I18nProvider>` with no props and still gets engine
// English at zero measurable cost. The provider imports NO game module and NO
// store: the caller (a later bootstrap) reads settings/registry and passes the
// locale, declared languages, game override bundle, and token flag down — the
// game override reaches here only through registry indirection (Invariants
// #80/#94), and the locale is UI state passed in, never read from simulation
// (Invariant #36).

import React, { type ReactNode, useCallback, useMemo } from 'react';

import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { engineBundleEn } from './engine-bundle.en.js';
import { formatMessage } from './format-message.js';
import { I18nContext, type I18nContextValue, type MessageParams } from './i18n-context.js';
import {
    resolveTranslation,
    type ResolvedBundles,
    type TranslationBundle,
    type TranslationKey,
} from './translation-bundle.js';

/** Default effective locale for a single-language / no-i18n game. */
const DEFAULT_LOCALE = 'en-US';

const NO_LANGUAGES: readonly GameLanguage[] = [];

export interface I18nProviderProps {
    /**
     * The persisted active locale (BCP-47), typically `gameplay.language`.
     * Defaults to {@link DEFAULT_LOCALE}. If it matches none of {@link languages},
     * the first declared language is used instead (see {@link resolveEffectiveLocale}).
     */
    readonly locale?: string;
    /**
     * The game's declared UI languages (already resolved/validated by the
     * caller). Empty ⇒ single-language: no fallback target beyond the default.
     * The game override bundle reaches this provider by prop, never by import.
     */
    readonly languages?: readonly GameLanguage[];
    /**
     * The game's contributed override bundle for the active locale, supplied by
     * the caller through registry indirection. Absent ⇒ pure engine English.
     * Keys re-key engine tokens and/or add game tokens; it is checked before the
     * engine default.
     */
    readonly gameOverride?: TranslationBundle;
    /**
     * Debug token-mode flag, supplied by the caller. When `true`, `t` returns
     * raw tokens for every key so translators can audit coverage in place.
     * Defaults to `false`.
     */
    readonly showTokens?: boolean;
    readonly children: ReactNode;
}

/**
 * The effective locale: the persisted `locale` when it is one of the declared
 * language codes; otherwise the first declared language (the game's default);
 * otherwise {@link DEFAULT_LOCALE}. Codes are opaque BCP-47 strings here — no
 * `Intl` normalization; an exact-code match is required.
 */
function resolveEffectiveLocale(locale: string, languages: readonly GameLanguage[]): string {
    if (languages.some((language) => language.code === locale)) {
        return locale;
    }
    return languages[0]?.code ?? DEFAULT_LOCALE;
}

export function I18nProvider({
    locale = DEFAULT_LOCALE,
    languages = NO_LANGUAGES,
    gameOverride,
    showTokens = false,
    children,
}: I18nProviderProps): React.ReactElement {
    const effectiveLocale = useMemo(
        () => resolveEffectiveLocale(locale, languages),
        [locale, languages],
    );

    const bundles = useMemo<ResolvedBundles>(
        () => ({
            locale: effectiveLocale,
            // Only include the key when a bundle is supplied: ResolvedBundles
            // declares `gameOverride?` and the tree is compiled with
            // exactOptionalPropertyTypes, so an explicit `undefined` is rejected.
            ...(gameOverride !== undefined ? { gameOverride } : {}),
            engineDefault: engineBundleEn,
        }),
        [effectiveLocale, gameOverride],
    );

    const t = useCallback(
        (key: TranslationKey, params?: MessageParams): string => {
            const resolved = resolveTranslation(bundles, key, showTokens);
            // A `missing`/`token-mode` template is the raw key or literal, not an
            // authored ICU message: return it verbatim so a literal label a game
            // passes through — or a raw token in debug mode — is never mangled by
            // the formatter (e.g. an unescaped `{…}` dropped as an unknown param).
            if (resolved.source === 'missing' || resolved.source === 'token-mode') {
                return resolved.template;
            }
            return formatMessage(resolved.template, params, effectiveLocale);
        },
        [bundles, showTokens, effectiveLocale],
    );

    const value = useMemo<I18nContextValue>(
        () => ({ locale: effectiveLocale, t }),
        [effectiveLocale, t],
    );

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
