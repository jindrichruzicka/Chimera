'use client';

// renderer/shell/SettingsLanguageSelector.tsx
//
// Store-connected wrapper around the pure `<LanguageSelector>` design primitive.
// It resolves the game context, loads the game's declared `languages` through the
// registry shell seam (`translations.languages` — never a direct `games/*`
// import, Invariants #80/#94), reads the persisted `gameplay.language`, and writes
// the chosen locale back through the settings store's existing IPC path.
//
// The store coupling lives HERE, not in `components/ui/LanguageSelector`, so the
// public ui barrel stays side-effect-free: importing a design primitive never
// drags in `renderer/state/`. Games mount this wrapper (or supply their own
// languages to the primitive directly); the settings language field renders it
// too.

import React, { useEffect, useState } from 'react';
import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import { LanguageSelector } from '../components/ui/LanguageSelector';
import { loadRendererGameShell } from '../game/rendererGameRegistry';
import { ENGINE_SETTINGS_GAME_ID } from '../input/KeyBindingRepository';
import { useSettingsStore } from '../state/settingsStore';

/** Fallback locale when the game has no persisted `gameplay.language`. */
const DEFAULT_LOCALE = 'en-US';

export interface SettingsLanguageSelectorProps {
    /** Override the game context; defaults to the active game in `settingsStore`. */
    readonly gameId?: string;
    /**
     * Explicit declared-language list. When omitted, the languages are resolved
     * asynchronously from the loaded renderer game shell (`translations.languages`).
     */
    readonly languages?: readonly GameLanguage[];
    readonly className?: string;
    /** `'select'` (default) or `'inline'` (segmented buttons) presentation. */
    readonly variant?: 'select' | 'inline';
}

/** A resolved declared-language read: the list plus whether the load settled. */
export interface DeclaredLanguages {
    readonly languages: readonly GameLanguage[];
    /**
     * `false` until the async shell load resolves (or immediately `true` when an
     * explicit list is supplied). Callers deciding "no language choice" must gate
     * on this so a still-loading game is not mistaken for a single-language one.
     */
    readonly ready: boolean;
}

/**
 * Resolve declared languages: the explicit prop when supplied, otherwise the
 * active game's shell-contributed `translations.languages`, loaded lazily. A
 * failed load resolves to an empty list (the selector then self-hides). The
 * `ready` flag lets a caller distinguish "still loading" from "loaded, <2
 * languages" — the settings surface needs that to place its empty-state message
 * without flashing it while languages are in flight.
 */
export function useDeclaredLanguages(
    gameId: string,
    explicit: readonly GameLanguage[] | undefined,
): DeclaredLanguages {
    const [loaded, setLoaded] = useState<DeclaredLanguages>({ languages: [], ready: false });

    useEffect(() => {
        if (explicit !== undefined) {
            return;
        }
        // Clear immediately so a gameId change never flashes the previous game's
        // languages while the new shell load is still in flight.
        setLoaded({ languages: [], ready: false });
        let disposed = false;
        loadRendererGameShell(gameId)
            .then((shell) => {
                if (!disposed) {
                    setLoaded({ languages: shell.translations?.languages ?? [], ready: true });
                }
            })
            .catch(() => {
                if (!disposed) {
                    setLoaded({ languages: [], ready: true });
                }
            });
        return () => {
            disposed = true;
        };
    }, [gameId, explicit]);

    return explicit === undefined ? loaded : { languages: explicit, ready: true };
}

export function SettingsLanguageSelector({
    gameId: gameIdProp,
    languages: languagesProp,
    className,
    variant,
}: SettingsLanguageSelectorProps): React.ReactElement | null {
    const activeGameId = useSettingsStore((state) => state.activeGameId);
    const gameId = gameIdProp ?? activeGameId ?? ENGINE_SETTINGS_GAME_ID;

    const { languages } = useDeclaredLanguages(gameId, languagesProp);

    const value = useSettingsStore((state) => {
        const settings = state.settings[gameId] as { gameplay?: { language?: string } } | undefined;
        return settings?.gameplay?.language ?? DEFAULT_LOCALE;
    });

    function handleLanguageChange(code: string): void {
        useSettingsStore
            .getState()
            .updateSettings(gameId, { gameplay: { language: code } })
            .catch((error: unknown) => {
                console.error('[SettingsLanguageSelector] Failed to update language:', error);
            });
    }

    return (
        <LanguageSelector
            languages={languages}
            value={value}
            onLanguageChange={handleLanguageChange}
            // Locale-independent E2E handle: the field's accessible name is
            // itself translated ("Language" → "Jazyk").
            testId="settings-language"
            {...(className === undefined ? {} : { className })}
            {...(variant === undefined ? {} : { variant })}
        />
    );
}
