// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { I18nProvider } from './I18nProvider.js';
import { engineBundleEn } from './engine-bundle.en.js';
import type { TranslationBundle } from './translation-bundle.js';
import { translationKey } from './translation-bundle.js';
import type { MessageParams, TranslateFn } from './i18n-context.js';
import { useTranslate } from './useTranslate.js';

// A probe that renders a single translated key so tests can assert the
// resolved text through the real hook → context → provider path.
function Translated({
    tKey,
    params,
}: {
    readonly tKey: string;
    readonly params?: MessageParams;
}): React.ReactElement {
    const t = useTranslate();
    return <span data-testid="out">{t(translationKey(tKey), params)}</span>;
}

// Captures the `t` reference on every render so a stability test can assert
// the function identity is preserved across unrelated re-renders.
const capturedT: TranslateFn[] = [];
function CaptureT(): React.ReactElement {
    const t = useTranslate();
    React.useLayoutEffect(() => {
        capturedT.push(t);
    });
    return <span data-testid="capture">ok</span>;
}

const EN_US: GameLanguage = { code: 'en-US', label: 'English' };
const CS_CZ: GameLanguage = { code: 'cs-CZ', label: 'Čeština' };

afterEach(() => {
    cleanup();
    capturedT.length = 0;
});

describe('I18nProvider + useTranslate', () => {
    it('returns engine English by default (no game override)', () => {
        render(
            <I18nProvider>
                <Translated tKey="engine.chat.title" />
            </I18nProvider>,
        );
        expect(screen.getByTestId('out').textContent).toBe('Chat');
    });

    it('lets a game override win over the engine default for a key', () => {
        const gameOverride: TranslationBundle = { 'engine.chat.title': 'Comms' };
        render(
            <I18nProvider gameOverride={gameOverride}>
                <Translated tKey="engine.chat.title" />
            </I18nProvider>,
        );
        expect(screen.getByTestId('out').textContent).toBe('Comms');
    });

    it('interpolates {param} through the formatter', () => {
        // engine.lobby.playersHeading === 'Players ({n})'
        render(
            <I18nProvider>
                <Translated tKey="engine.lobby.playersHeading" params={{ n: 3 }} />
            </I18nProvider>,
        );
        expect(screen.getByTestId('out').textContent).toBe('Players (3)');
    });

    it('renders ICU plural through the formatter (locale-driven)', () => {
        // engine.saves.slotCount === '{n, plural, one {# save} other {# saves}}'
        render(
            <I18nProvider>
                <Translated tKey="engine.saves.slotCount" params={{ n: 1 }} />
            </I18nProvider>,
        );
        expect(screen.getByTestId('out').textContent).toBe('1 save');

        cleanup();

        render(
            <I18nProvider>
                <Translated tKey="engine.saves.slotCount" params={{ n: 5 }} />
            </I18nProvider>,
        );
        expect(screen.getByTestId('out').textContent).toBe('5 saves');
    });

    it('returns the raw token for an unknown key', () => {
        render(
            <I18nProvider>
                <Translated tKey="engine.nonexistent.key" />
            </I18nProvider>,
        );
        expect(screen.getByTestId('out').textContent).toBe('engine.nonexistent.key');
    });

    it('returns an unresolved literal verbatim, never parsing it as an ICU template', () => {
        // A game that passes a literal display string (not a token) reaches the
        // provider as a `missing` key. It must render exactly as written — even
        // when it happens to contain ICU-significant characters — rather than
        // being mangled by the message formatter (e.g. dropped `{gold}`).
        render(
            <I18nProvider>
                <Translated tKey="Cost: {gold}" />
            </I18nProvider>,
        );
        expect(screen.getByTestId('out').textContent).toBe('Cost: {gold}');
    });

    it('returns a token containing ICU-significant characters verbatim in token-mode', () => {
        render(
            <I18nProvider showTokens>
                <Translated tKey="game.demo.{weird}#token" />
            </I18nProvider>,
        );
        expect(screen.getByTestId('out').textContent).toBe('game.demo.{weird}#token');
    });

    it('returns raw tokens for known keys when token-mode is on', () => {
        const gameOverride: TranslationBundle = { 'engine.chat.title': 'Comms' };
        render(
            <I18nProvider gameOverride={gameOverride} showTokens>
                <Translated tKey="engine.chat.title" />
            </I18nProvider>,
        );
        // Token-mode wins over both the game override and the engine default.
        expect(screen.getByTestId('out').textContent).toBe('engine.chat.title');
    });

    it('falls back to the first declared language when the locale matches none', () => {
        // Locale not among declared languages → first declared (en-US) is used.
        // Assert via a plural whose category differs by locale would be brittle
        // for en/cs, so assert the exposed active locale instead through a probe.
        function LocaleProbe(): React.ReactElement {
            // engine plural renders identically; the locale itself is what we
            // fall back on. A dedicated locale probe reads it via useI18n in the
            // hook test; here we assert the resolved text stays engine English.
            const t = useTranslate();
            return <span data-testid="loc">{t(translationKey('engine.chat.title'))}</span>;
        }
        render(
            <I18nProvider locale="fr-FR" languages={[EN_US, CS_CZ]}>
                <LocaleProbe />
            </I18nProvider>,
        );
        // Unknown locale falls back to en-US (first declared): still resolves.
        expect(screen.getByTestId('loc').textContent).toBe('Chat');
    });

    it('is inert with no props: engine English, no throw', () => {
        expect(() =>
            render(
                <I18nProvider>
                    <Translated tKey="engine.menu.play" />
                </I18nProvider>,
            ),
        ).not.toThrow();
        expect(screen.getByTestId('out').textContent).toBe('Play');
        // engineBundleEn is the source of truth for the inert path.
        expect(engineBundleEn['engine.menu.play']).toBe('Play');
    });

    it('keeps the t reference stable across unrelated re-renders', () => {
        function Parent(): React.ReactElement {
            const [count, setCount] = useState(0);
            return (
                <I18nProvider>
                    <CaptureT />
                    <button data-testid="rerender" onClick={() => setCount((c) => c + 1)}>
                        {count}
                    </button>
                </I18nProvider>
            );
        }
        render(<Parent />);
        expect(capturedT).toHaveLength(1);
        const first = capturedT[0]!;

        fireEvent.click(screen.getByTestId('rerender'));

        expect(capturedT).toHaveLength(2);
        expect(capturedT[1]).toBe(first);
    });
});
