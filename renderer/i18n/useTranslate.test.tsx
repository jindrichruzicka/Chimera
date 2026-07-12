// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { I18nProvider } from './I18nProvider.js';
import { useI18n, useTranslate } from './useTranslate.js';

const EN_US: GameLanguage = { code: 'en-US', label: 'English' };
const CS_CZ: GameLanguage = { code: 'cs-CZ', label: 'Čeština' };

function TranslateConsumer(): React.ReactElement {
    const t = useTranslate();
    return <span>{typeof t}</span>;
}

function LocaleConsumer(): React.ReactElement {
    const { locale } = useI18n();
    return <span data-testid="locale">{locale}</span>;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useTranslate / useI18n', () => {
    it('throws a descriptive error when used outside a provider', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(() => render(<TranslateConsumer />)).toThrow(
            'useI18n/useTranslate must be used within I18nProvider',
        );
    });

    it('exposes the active locale when the persisted locale is declared', () => {
        render(
            <I18nProvider locale="cs-CZ" languages={[EN_US, CS_CZ]}>
                <LocaleConsumer />
            </I18nProvider>,
        );
        expect(screen.getByTestId('locale').textContent).toBe('cs-CZ');
    });

    it('falls back to the first declared language when the locale matches none', () => {
        render(
            <I18nProvider locale="fr-FR" languages={[CS_CZ, EN_US]}>
                <LocaleConsumer />
            </I18nProvider>,
        );
        // First declared language is cs-CZ here; the unknown fr-FR falls back to it.
        expect(screen.getByTestId('locale').textContent).toBe('cs-CZ');
    });

    it('defaults to en-US when no languages are declared (inert path)', () => {
        render(
            <I18nProvider>
                <LocaleConsumer />
            </I18nProvider>,
        );
        expect(screen.getByTestId('locale').textContent).toBe('en-US');
    });
});
