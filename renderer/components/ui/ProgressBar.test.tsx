// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar';
import progressBarCss from './ProgressBar.module.css?raw';

afterEach(() => {
    cleanup();
});

describe('ProgressBar', () => {
    it('renders progressbar semantics with bounded values', () => {
        render(<ProgressBar label="Loading" value={120} max={100} />);

        const progress = screen.getByRole('progressbar', { name: 'Loading' });
        expect(progress).toHaveAttribute('aria-valuemin', '0');
        expect(progress).toHaveAttribute('aria-valuemax', '100');
        expect(progress).toHaveAttribute('aria-valuenow', '100');
    });

    it('fills with the strong accent so the meter passes non-text contrast', () => {
        const fillRule = /\.fill\s*\{[^}]*\}/s.exec(progressBarCss)?.[0] ?? '';
        expect(fillRule).toContain('background-color: var(--ch-color-accent-strong)');
    });

    it('stretches to its container instead of borrowing the button width scale', () => {
        const rootRule = /\.root\s*\{[^}]*\}/s.exec(progressBarCss)?.[0] ?? '';
        expect(rootRule).toContain('inline-size: 100%');
        expect(progressBarCss).not.toContain('var(--ch-button-min-width-lg)');
    });

    it('draws the track border at the sm border width token', () => {
        expect(progressBarCss).toContain('border-width: var(--ch-border-width-sm)');
        expect(progressBarCss).not.toContain('var(--ch-button-border-width)');
    });
});
