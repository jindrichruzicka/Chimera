// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DismissButton } from './DismissButton';
import css from './DismissButton.module.css?raw';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('DismissButton', () => {
    it('renders a button with the required accessible name', () => {
        render(<DismissButton aria-label="Delete save Alpha" />);

        expect(screen.getByRole('button', { name: 'Delete save Alpha' })).toBeInTheDocument();
    });

    it('renders the cross glyph hidden from assistive technology', () => {
        render(<DismissButton aria-label="Close" />);

        const glyph = screen.getByRole('button', { name: 'Close' }).querySelector('span');
        expect(glyph).toHaveAttribute('aria-hidden', 'true');
        expect(glyph).toHaveTextContent('×');
    });

    it('renders as a ghost icon button carrying the shared dismiss marker', () => {
        render(<DismissButton aria-label="Close" />);

        const button = screen.getByRole('button', { name: 'Close' });
        expect(button).toHaveAttribute('data-ch-icon-button-variant', 'ghost');
        expect(button).toHaveAttribute('data-ch-dismiss-button');
    });

    it('fires onClick when clicked', () => {
        const handler = vi.fn();
        render(<DismissButton aria-label="Dismiss" onClick={handler} />);

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('forwards className and data-testid alongside its own class', () => {
        render(
            <DismissButton aria-label="Delete" className="extra-class" data-testid="row-delete" />,
        );

        const button = screen.getByTestId('row-delete');
        expect(button).toHaveClass('extra-class');
        expect(button.className).toContain('dismiss');
    });

    it('swaps to the danger tokens on hover and keyboard focus (visible border affordance)', () => {
        const rule = /\.dismiss:hover,\s*\.dismiss:focus-visible\s*\{([^}]*)\}/s.exec(css)?.[1];

        expect(rule).toBeDefined();
        expect(rule).toContain('--ch-icon-button-color: var(--ch-button-color-danger)');
        expect(rule).toContain('--ch-icon-button-bg-hover: var(--ch-button-bg-danger-hover)');
        expect(rule).toContain(
            '--ch-icon-button-border-color-hover: var(--ch-button-border-danger-hover)',
        );
    });

    it('CSS does not contain hardcoded colour, spacing, or radius values (invariant #86)', () => {
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        const hardcoded = css.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
        expect(hardcoded).toBeNull();
    });

    it('renders its glyph as a text span, never an svg (so IconButton svg sizing cannot reach it)', () => {
        // Pins the boundary that lets IconButton's `.icon-button svg` rule size
        // SVG glyphs without disturbing this button's `&times;` text glyph.
        render(<DismissButton aria-label="Close" />);

        const button = screen.getByRole('button', { name: 'Close' });
        expect(button.querySelector('span')).not.toBeNull();
        expect(button.querySelector('svg')).toBeNull();
    });
});
