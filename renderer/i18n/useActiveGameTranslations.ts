'use client';

// renderer/i18n/useActiveGameTranslations.ts
//
// Resolves the active game's i18n inputs for the app-wide <I18nProvider>: the
// declared languages, the persisted locale (`gameplay.language`), and the
// game's contributed override bundle for that locale. The bundle reaches the
// provider ONLY through the registry shell seam (`translations` — never a direct
// `games/*` import, Invariants #80/#94), mirroring how SettingsLanguageSelector
// resolves declared languages and ShellBackgroundHost resolves the background.
//
// Live-switch: the locale is read from `settingsStore` with a narrow selector,
// so persisting a new `gameplay.language` re-renders and re-selects the bundle
// without a reload. A game-context change (new gameId) reloads the shell.

import { useEffect, useState } from 'react';

import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { loadRendererGameShell } from '../game/rendererGameRegistry';
import { useActiveShellGameId } from '../shell/useActiveShellGameId';
import { useSettingsStore } from '../state/settingsStore';
import type { TranslationBundle } from './translation-bundle';

/** Fallback locale when the game has no persisted `gameplay.language`. */
const DEFAULT_LOCALE = 'en-US';

/** The resolved i18n inputs for the active game context. */
export interface ActiveGameI18n {
    /** The persisted active locale (BCP-47), or the engine default. */
    readonly locale: string;
    /** The active game's declared UI languages (empty when none / no game). */
    readonly languages: readonly GameLanguage[];
    /**
     * The active game's override bundle for the active locale, or `undefined`
     * when there is no game context or no bundle for the locale (⇒ engine English).
     */
    readonly gameOverride: TranslationBundle | undefined;
}

const NO_LANGUAGES: readonly GameLanguage[] = [];

type LoadedTranslations = Readonly<{
    gameId: string | null;
    languages: readonly GameLanguage[];
    bundles: Readonly<Record<string, TranslationBundle>>;
}>;

const EMPTY_LOADED: LoadedTranslations = {
    gameId: null,
    languages: NO_LANGUAGES,
    bundles: {},
};

/**
 * Resolve the active game's declared languages + per-locale override bundles,
 * loaded lazily from the registry shell seam. A failed load or absent game
 * resolves to the empty set (engine English).
 */
function useLoadedTranslations(gameId: string | null): LoadedTranslations {
    const [loaded, setLoaded] = useState<LoadedTranslations>(EMPTY_LOADED);

    useEffect(() => {
        if (gameId === null) {
            setLoaded(EMPTY_LOADED);
            return;
        }
        // Clear immediately so a gameId change never applies the previous game's
        // bundle while the new shell load is still in flight.
        setLoaded(EMPTY_LOADED);
        let disposed = false;
        loadRendererGameShell(gameId)
            .then((shell) => {
                if (disposed) {
                    return;
                }
                const translations = shell.translations;
                setLoaded({
                    gameId,
                    languages: translations?.languages ?? NO_LANGUAGES,
                    bundles: translations?.bundles ?? {},
                });
            })
            .catch(() => {
                if (!disposed) {
                    setLoaded({ gameId, languages: NO_LANGUAGES, bundles: {} });
                }
            });
        return () => {
            disposed = true;
        };
    }, [gameId]);

    // Ignore a stale in-flight result for a previous gameId.
    return loaded.gameId === gameId ? loaded : EMPTY_LOADED;
}

/**
 * The persisted active locale for the given game, read reactively so a settings
 * change relocalizes live. Falls back to the engine default.
 */
function usePersistedLocale(gameId: string | null): string {
    return useSettingsStore((state) => {
        if (gameId === null) {
            return DEFAULT_LOCALE;
        }
        const settings = state.settings[gameId] as { gameplay?: { language?: string } } | undefined;
        return settings?.gameplay?.language ?? DEFAULT_LOCALE;
    });
}

/**
 * Resolve the active game's i18n inputs for the app-wide provider. Returns
 * engine-English defaults (no override, default locale, no languages) whenever
 * there is no game context — so a no-i18n game (or the bare engine shell) pays
 * zero cost and renders identically to mounting `<I18nProvider>` bare.
 */
export function useActiveGameTranslations(): ActiveGameI18n {
    const gameId = useActiveShellGameId();
    const loaded = useLoadedTranslations(gameId);
    const locale = usePersistedLocale(gameId);
    const gameOverride = loaded.bundles[locale];

    return {
        locale,
        languages: loaded.languages,
        gameOverride,
    };
}
