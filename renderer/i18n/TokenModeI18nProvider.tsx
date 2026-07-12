'use client';

// renderer/i18n/TokenModeI18nProvider.tsx
//
// Store-connected wrapper around the pure <I18nProvider>. It reads the
// renderer-only debug flag `debugI18nStore.showTranslationTokens` via a narrow
// selector and forwards it as the provider's `showTokens` prop, so flipping the
// flag (from the Debug Inspector's "Show translation tokens" toggle) re-renders
// every useTranslate() consumer with raw tokens instead of translated strings.
//
// Kept as a thin 'use client' wrapper (mirroring SettingsLanguageSelector) so
// AppShell stays a server component: the store subscription lives here, not in
// AppShell. In production the flag is never flipped (nothing pushes on the
// debug channel), so this resolves engine English at zero cost — identical to
// mounting <I18nProvider> bare.

import React, { type ReactNode } from 'react';

import { useDebugI18nStore } from '../state/debugI18nStore';
import { I18nProvider } from './I18nProvider';

export interface TokenModeI18nProviderProps {
    readonly children: ReactNode;
}

export function TokenModeI18nProvider({
    children,
}: TokenModeI18nProviderProps): React.ReactElement {
    const showTokens = useDebugI18nStore((state) => state.showTranslationTokens);
    return <I18nProvider showTokens={showTokens}>{children}</I18nProvider>;
}
