// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';
import spinnerCss from './Spinner.module.css?raw';

afterEach(() => {
    cleanup();
});

describe('Spinner', () => {
    it('renders a labelled status indicator', () => {
        render(<Spinner label="Loading assets" />);

        expect(screen.getByRole('status', { name: 'Loading assets' })).toBeInTheDocument();
    });

    it('renders an indicator element inside the status container', () => {
        render(<Spinner label="Loading assets" />);

        const status = screen.getByRole('status', { name: 'Loading assets' });
        expect(status.firstElementChild).toBeInTheDocument();
    });

    it('paints the rotating segment with the strong accent on an sm border ring', () => {
        // accent-strong is the graphical-indicator step of the ramp: 3:1+
        // against the border ring (WCAG 1.4.11); plain accent is only 2.6:1.
        expect(spinnerCss).toContain('border-top-color: var(--ch-color-accent-strong)');
        expect(spinnerCss).toContain('border-width: var(--ch-border-width-sm)');
        expect(spinnerCss).not.toContain('var(--ch-button-border-width)');
    });
});
