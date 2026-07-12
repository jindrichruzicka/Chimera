// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import { I18nProvider } from '../../i18n/I18nProvider';
import { LanguageSelector } from './LanguageSelector';
import { LanguageSelector as BarrelLanguageSelector } from './index';
import css from './LanguageSelector.module.css?raw';

const LANGUAGES: readonly GameLanguage[] = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
];

// The component reads its accessible name through useTranslate(), which throws
// outside a provider — mount it inert (engine English) for every render.
const render = (ui: ReactElement): ReturnType<typeof baseRender> =>
    baseRender(<I18nProvider>{ui}</I18nProvider>);

function expectTokenizedCss(source: string): void {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const hardcodedPixels = source.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
    expect(hardcodedPixels).toBeNull();
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('LanguageSelector', () => {
    it('renders the declared languages as options with endonym labels (select variant)', () => {
        render(
            <LanguageSelector
                languages={LANGUAGES}
                value="en-US"
                onLanguageChange={() => undefined}
            />,
        );

        const select = screen.getByRole('combobox', { name: 'Language' });
        expect(screen.getByRole('option', { name: 'English' })).toHaveValue('en-US');
        expect(screen.getByRole('option', { name: 'Čeština' })).toHaveValue('cs-CZ');
        expect(select).toHaveValue('en-US');
    });

    it('reflects the supplied current value', () => {
        render(
            <LanguageSelector
                languages={LANGUAGES}
                value="cs-CZ"
                onLanguageChange={() => undefined}
            />,
        );

        expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('cs-CZ');
    });

    it('calls onLanguageChange with the chosen code when a language is selected', async () => {
        const user = userEvent.setup();
        const onLanguageChange = vi.fn();
        render(
            <LanguageSelector
                languages={LANGUAGES}
                value="en-US"
                onLanguageChange={onLanguageChange}
            />,
        );

        await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'cs-CZ');

        expect(onLanguageChange).toHaveBeenCalledWith('cs-CZ');
    });

    it('renders null when the game declares fewer than two languages', () => {
        const { container } = render(
            <LanguageSelector
                languages={[LANGUAGES[0]!]}
                value="en-US"
                onLanguageChange={() => undefined}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders null when the game declares no languages', () => {
        const { container } = render(
            <LanguageSelector languages={[]} value="en-US" onLanguageChange={() => undefined} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders the inline variant as a radiogroup with one control per language', () => {
        render(
            <LanguageSelector
                languages={LANGUAGES}
                value="en-US"
                onLanguageChange={() => undefined}
                variant="inline"
            />,
        );

        expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByRole('button', { name: 'Čeština' })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('calls onLanguageChange when an inline control is activated', async () => {
        const user = userEvent.setup();
        const onLanguageChange = vi.fn();
        render(
            <LanguageSelector
                languages={LANGUAGES}
                value="en-US"
                onLanguageChange={onLanguageChange}
                variant="inline"
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Čeština' }));

        expect(onLanguageChange).toHaveBeenCalledWith('cs-CZ');
    });

    it('applies a caller className to the select variant root', () => {
        const { container } = render(
            <LanguageSelector
                languages={LANGUAGES}
                value="en-US"
                onLanguageChange={() => undefined}
                className="my-lang"
            />,
        );

        expect(container.querySelector('.my-lang')).not.toBeNull();
    });

    it('is exported from the public ui barrel', () => {
        expect(BarrelLanguageSelector).toBe(LanguageSelector);
    });

    it('uses only tokenized CSS values', () => {
        expectTokenizedCss(css);
    });
});
