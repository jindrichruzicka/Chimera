'use client';

// renderer/i18n/TokenModeI18nProvider.tsx
//
// Store-connected wrapper around the pure <I18nProvider>. It resolves the active
// game's i18n inputs — the persisted locale (`gameplay.language`), the declared
// languages, and the game's contributed override bundle for that locale, all via
// the registry shell seam (never a direct `games/*` import, Invariants #80/#94) —
// and forwards them plus the renderer-only debug flag
// `debugI18nStore.showTranslationTokens` to the provider.
//
// This is where the opt-in i18n system becomes live: a game that declares
// languages and contributes bundles has its UI localised here, and persisting a
// new `gameplay.language` relocalizes the running UI without a reload (the locale
// is read reactively). A no-i18n game resolves to engine English at zero cost —
// identical to mounting <I18nProvider> bare.
//
// Kept as a thin 'use client' wrapper (mirroring SettingsLanguageSelector) so
// AppShell stays a server component: the store subscriptions live here.

import React, { type ReactNode } from 'react';

import { useDebugI18nStore } from '../state/debugI18nStore';
import { I18nProvider } from './I18nProvider';
import { useActiveGameTranslations } from './useActiveGameTranslations';

export interface TokenModeI18nProviderProps {
    readonly children: ReactNode;
}

export function TokenModeI18nProvider({
    children,
}: TokenModeI18nProviderProps): React.ReactElement {
    const showTokens = useDebugI18nStore((state) => state.showTranslationTokens);
    const { locale, languages, gameOverride } = useActiveGameTranslations();

    return (
        <I18nProvider
            locale={locale}
            languages={languages}
            showTokens={showTokens}
            // Spread the override only when present: I18nProvider declares it
            // optional and the tree compiles with exactOptionalPropertyTypes.
            {...(gameOverride !== undefined ? { gameOverride } : {})}
        >
            {children}
        </I18nProvider>
    );
}
