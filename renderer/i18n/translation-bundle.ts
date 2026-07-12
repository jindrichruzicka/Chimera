// renderer/i18n/translation-bundle.ts
//
// Framework-free core of the opt-in renderer i18n system: decides how a UI
// string key resolves for the active locale. Zero imports — no React, no
// simulation/ai runtime, no Electron, no game module — so this can sit under
// any future call site (hook, provider, or a plain render function) without
// dragging in a platform dependency.

/**
 * Opaque translation-string key. Branded to prevent accidental mixing with
 * other string-shaped values (e.g. themeId, gameId).
 *
 * Use {@link translationKey} to construct a value from a raw string.
 */
export type TranslationKey = string & { readonly __brand: 'TranslationKey' };

/**
 * Constructs a branded {@link TranslationKey} from a raw string.
 *
 * This is the single authorised cast site for the TranslationKey brand.
 * All production code and test helpers must call this instead of writing
 * `raw as TranslationKey` directly.
 */
export function translationKey(raw: string): TranslationKey {
    return raw as TranslationKey;
}

/** Flat key → template map for one locale. Templates may carry ICU syntax; this layer never parses it. */
export type TranslationBundle = Readonly<Record<string, string>>;

/** The bundles available for resolving one locale, in fallback-chain order. */
export interface ResolvedBundles {
    readonly locale: string;
    /** Game-contributed overrides for this locale; checked first when present. */
    readonly gameOverride?: TranslationBundle;
    /** Engine's built-in (English) bundle; always present as the final fallback before a raw key. */
    readonly engineDefault: TranslationBundle;
}

/** Which tier of the fallback chain produced a {@link ResolvedTranslation}. */
export type TranslationSource = 'game' | 'engine' | 'missing' | 'token-mode';

export interface ResolvedTranslation {
    /** The resolved (untouched, possibly ICU-syntax) template, or the raw key when unresolved. */
    readonly template: string;
    readonly source: TranslationSource;
}

/**
 * Resolves a {@link TranslationKey} against a locale's bundles.
 *
 * Fallback-chain precedence: game override → engine default → raw key
 * (`source: 'missing'`, `template === key`).
 *
 * `showTokens` is checked first and returns immediately without reading
 * `bundles` at all — a debug affordance for translators to see raw keys
 * in place of resolved text, independent of what the bundles contain.
 */
export function resolveTranslation(
    bundles: ResolvedBundles,
    key: TranslationKey,
    showTokens = false,
): ResolvedTranslation {
    if (showTokens) {
        return { template: key, source: 'token-mode' };
    }
    if (bundles.gameOverride?.[key] !== undefined) {
        return { template: bundles.gameOverride[key], source: 'game' };
    }
    if (bundles.engineDefault[key] !== undefined) {
        return { template: bundles.engineDefault[key], source: 'engine' };
    }
    return { template: key, source: 'missing' };
}
