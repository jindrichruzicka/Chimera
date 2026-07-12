'use client';

// renderer/app/DebugI18nBootstrap.tsx
//
// Headless subscription wiring the debug i18n token-mode push to the renderer
// store. On mount it subscribes to `system.onI18nTokenMode` — the main-process
// debug bridge pushes the flag here after the Inspector's "Show translation
// tokens" toggle changes — and flips `debugI18nStore.showTranslationTokens`,
// which the TokenModeI18nProvider forwards to <I18nProvider showTokens>.
//
// In production the debug bridge never starts, so nothing is ever pushed and
// this is an idle no-op (Invariant #27). Renders nothing.

import { useEffect } from 'react';

import { getSystemBridge } from '../bridge/system-bridge';
import { useDebugI18nStore } from '../state/debugI18nStore';

export function DebugI18nBootstrap(): null {
    useEffect(() => {
        const system = getSystemBridge();
        if (system === null || typeof system.onI18nTokenMode !== 'function') {
            return undefined;
        }
        return system.onI18nTokenMode((enabled) => {
            useDebugI18nStore.getState().setShowTranslationTokens(enabled);
        });
    }, []);

    return null;
}
