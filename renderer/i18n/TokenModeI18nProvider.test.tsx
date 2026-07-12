// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDebugI18nStore } from '../state/debugI18nStore';
import { translationKey } from './translation-bundle.js';
import { TokenModeI18nProvider } from './TokenModeI18nProvider';
import { useTranslate } from './useTranslate.js';

function Translated({ tKey }: { readonly tKey: string }): React.ReactElement {
    const t = useTranslate();
    return <span data-testid="out">{t(translationKey(tKey))}</span>;
}

afterEach(() => {
    cleanup();
    useDebugI18nStore.getState().setShowTranslationTokens(false);
});

describe('TokenModeI18nProvider', () => {
    it('renders translated strings when token mode is off (default)', () => {
        render(
            <TokenModeI18nProvider>
                <Translated tKey="engine.chat.title" />
            </TokenModeI18nProvider>,
        );

        expect(screen.getByTestId('out').textContent).toBe('Chat');
    });

    it('renders the raw token for a translated key when token mode is on', () => {
        useDebugI18nStore.getState().setShowTranslationTokens(true);

        render(
            <TokenModeI18nProvider>
                <Translated tKey="engine.chat.title" />
            </TokenModeI18nProvider>,
        );

        expect(screen.getByTestId('out').textContent).toBe('engine.chat.title');
    });

    it('renders the raw token for a missing key when token mode is on', () => {
        useDebugI18nStore.getState().setShowTranslationTokens(true);

        render(
            <TokenModeI18nProvider>
                <Translated tKey="engine.not.a.real.key" />
            </TokenModeI18nProvider>,
        );

        expect(screen.getByTestId('out').textContent).toBe('engine.not.a.real.key');
    });

    it('re-renders consumers live when the store flag flips', () => {
        render(
            <TokenModeI18nProvider>
                <Translated tKey="engine.chat.title" />
            </TokenModeI18nProvider>,
        );

        expect(screen.getByTestId('out').textContent).toBe('Chat');

        act(() => {
            useDebugI18nStore.getState().setShowTranslationTokens(true);
        });

        expect(screen.getByTestId('out').textContent).toBe('engine.chat.title');
    });
});
