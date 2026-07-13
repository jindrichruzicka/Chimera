// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebugI18nStore } from '../state/debugI18nStore';
import { useSettingsStore } from '../state/settingsStore';
import { translationKey, type TranslationBundle } from './translation-bundle.js';
import { TokenModeI18nProvider } from './TokenModeI18nProvider';
import { useTranslate } from './useTranslate.js';

// The provider resolves the active game id from the URL (`?gameId=`, read from
// window.location.search) and the active game's contributed bundles from the
// registry shell seam. Both are mocked/driven directly. `usePathname` only keys
// the effect that re-reads the URL, so a fixed stub is enough.
const { mockLoadRendererGameShell } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
}));

vi.mock('next/navigation', () => ({
    usePathname: () => '/main-menu',
}));

function setUrlGameId(gameId: string | null): void {
    window.history.replaceState(
        {},
        '',
        gameId === null ? '/main-menu' : `/main-menu?gameId=${gameId}`,
    );
}

vi.mock('../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

function Translated({ tKey }: { readonly tKey: string }): React.ReactElement {
    const t = useTranslate();
    return <span data-testid="out">{t(translationKey(tKey))}</span>;
}

const EN_BUNDLE: TranslationBundle = {
    'game.demo.title': 'Play',
    'engine.chat.title': 'Match chat',
};
const CS_BUNDLE: TranslationBundle = {
    'game.demo.title': 'Hrát',
    'engine.chat.title': 'Zápasový chat',
};

const DEMO_LANGUAGES = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
];

/** A loaded shell contributing the demo game's translations. */
function demoShell(): unknown {
    return {
        translations: {
            languages: DEMO_LANGUAGES,
            bundles: { 'en-US': EN_BUNDLE, 'cs-CZ': CS_BUNDLE },
        },
    };
}

function setDemoLocale(locale: string): void {
    useSettingsStore.setState({
        activeGameId: 'demo',
        settings: { demo: { gameplay: { language: locale } } },
    });
}

beforeEach(() => {
    setUrlGameId(null);
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({});
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

afterEach(() => {
    cleanup();
    useDebugI18nStore.getState().setShowTranslationTokens(false);
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

describe('TokenModeI18nProvider — token mode (no game context ⇒ engine English)', () => {
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

describe('TokenModeI18nProvider — active game bundle application', () => {
    it("applies the active game's bundle for the persisted locale (default en-US)", async () => {
        setUrlGameId('demo');
        mockLoadRendererGameShell.mockResolvedValue(demoShell());
        setDemoLocale('en-US');

        render(
            <TokenModeI18nProvider>
                <Translated tKey="game.demo.title" />
            </TokenModeI18nProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Play'));
        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('demo');
    });

    it("resolves an engine-token override from the game's bundle", async () => {
        setUrlGameId('demo');
        mockLoadRendererGameShell.mockResolvedValue(demoShell());
        setDemoLocale('en-US');

        render(
            <TokenModeI18nProvider>
                <Translated tKey="engine.chat.title" />
            </TokenModeI18nProvider>,
        );

        // The game re-keyed engine.chat.title, so the shared token now resolves
        // to the game's copy instead of the engine default 'Chat'.
        await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Match chat'));
    });

    it('applies the Czech bundle when gameplay.language = cs-CZ', async () => {
        setUrlGameId('demo');
        mockLoadRendererGameShell.mockResolvedValue(demoShell());
        setDemoLocale('cs-CZ');

        render(
            <TokenModeI18nProvider>
                <Translated tKey="game.demo.title" />
            </TokenModeI18nProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Hrát'));
    });

    it('relocalizes live when the persisted locale changes (no reload)', async () => {
        setUrlGameId('demo');
        mockLoadRendererGameShell.mockResolvedValue(demoShell());
        setDemoLocale('en-US');

        render(
            <TokenModeI18nProvider>
                <Translated tKey="game.demo.title" />
            </TokenModeI18nProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Play'));

        // Persisting a new locale must switch the running UI without a remount.
        act(() => {
            setDemoLocale('cs-CZ');
        });

        await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Hrát'));
    });

    it('falls back to engine English when no game context is present', () => {
        // No gameId in the URL, no active game: the game bundle never applies.
        render(
            <TokenModeI18nProvider>
                <Translated tKey="engine.chat.title" />
            </TokenModeI18nProvider>,
        );

        expect(screen.getByTestId('out').textContent).toBe('Chat');
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });
});
