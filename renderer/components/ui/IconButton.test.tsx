// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';
import css from './IconButton.module.css?raw';
import tokensCss from '../../styles/tokens.css?raw';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('IconButton', () => {
    it('renders with an accessible name provided via aria-label', () => {
        render(<IconButton aria-label="Close panel">X</IconButton>);

        expect(screen.getByRole('button', { name: 'Close panel' })).toBeInTheDocument();
    });

    it('renders with an accessible name provided via aria-labelledby', () => {
        render(
            <>
                <span id="label-id">Zoom in</span>
                <IconButton aria-labelledby="label-id">+</IconButton>
            </>,
        );

        expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    });

    it('defaults to type="button"', () => {
        render(<IconButton aria-label="Menu">☰</IconButton>);

        expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('type', 'button');
    });

    it('fires onClick when clicked', () => {
        const handler = vi.fn();
        render(
            <IconButton aria-label="Dismiss" onClick={handler}>
                ✕
            </IconButton>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('fires onClick when activated with Enter key', async () => {
        const user = userEvent.setup();
        const handler = vi.fn();
        render(
            <IconButton aria-label="Confirm" onClick={handler}>
                ✓
            </IconButton>,
        );

        const button = screen.getByRole('button', { name: 'Confirm' });
        button.focus();
        await user.keyboard('{Enter}');

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not fire onClick when disabled', () => {
        const handler = vi.fn();
        render(
            <IconButton aria-label="Locked" disabled onClick={handler}>
                🔒
            </IconButton>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Locked' }));

        expect(handler).not.toHaveBeenCalled();
    });

    it('forwards additional className', () => {
        render(
            <IconButton aria-label="Custom" className="extra-class">
                *
            </IconButton>,
        );

        expect(screen.getByRole('button', { name: 'Custom' })).toHaveClass('extra-class');
    });

    it('supports semantic variants for icon-only actions', () => {
        render(
            <>
                <IconButton aria-label="Default">D</IconButton>
                <IconButton aria-label="Danger" variant="danger">
                    X
                </IconButton>
            </>,
        );

        expect(screen.getByRole('button', { name: 'Default' })).toHaveAttribute(
            'data-ch-icon-button-variant',
            'secondary',
        );
        expect(screen.getByRole('button', { name: 'Danger' })).toHaveAttribute(
            'data-ch-icon-button-variant',
            'danger',
        );
        expect(screen.getByRole('button', { name: 'Danger' }).className).toContain('danger');
    });

    it('renders the ghost variant flat via the shared ghost shadow tokens', () => {
        expect(css).toMatch(
            /\.ghost\s*{[^}]*--ch-icon-button-shadow:\s*var\(--ch-button-shadow-ghost\);[^}]*--ch-icon-button-shadow-hover:\s*var\(--ch-button-shadow-hover-ghost\);/s,
        );
    });

    it('aligns the ghost hover glyph colour with the ghost Button hover token', () => {
        // A ghost icon button must light up on hover exactly like the ghost text
        // Button beside it: both resolve their hover colour from
        // --ch-button-color-ghost-hover (the game accent in a themed game), not
        // the generic icon-button-color-hover (which stays neutral text-primary).
        expect(css).toMatch(
            /\.ghost\s*{[^}]*--ch-icon-button-color-hover:\s*var\(--ch-button-color-ghost-hover\);/s,
        );
    });

    it('CSS does not contain hardcoded colour, spacing, or radius values (invariant #86)', () => {
        // No hex values
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        // No bare pixel values for colour/spacing/radius (allowed only inside var() fallbacks)
        const hardcoded = css.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
        expect(hardcoded).toBeNull();
    });

    it('uses a dedicated active transform token for pressed feedback', () => {
        expect(tokensCss).toContain('--ch-button-transform-active:');
        expect(css).toContain('transform: var(--ch-button-transform-active);');
        // The :active rule must follow :hover so the press transform wins at
        // equal specificity while the pointer is down.
        expect(css.indexOf('.icon-button:not(:disabled):active')).toBeGreaterThan(
            css.indexOf('.icon-button:not(:disabled):hover'),
        );
    });

    it('grows on hover via the icon-button hover transform token, enlarged for the ghost variant', () => {
        // The base hover applies the identity-by-default hover transform; the
        // ghost variant redirects it to the larger ghost scale so the
        // chrome-less dismiss/close crosses give strong feedback.
        expect(css).toMatch(
            /\.icon-button:not\(:disabled\):hover\s*{[^}]*transform:\s*var\(--ch-icon-button-transform-hover\);/s,
        );
        expect(css).toMatch(
            /\.ghost\s*{[^}]*--ch-icon-button-transform-hover:\s*var\(--ch-button-transform-hover-ghost\);/s,
        );
    });

    it('uses a discrete icon button size token without fractional calc', () => {
        expect(tokensCss).toContain('--ch-size-icon-button:');
        expect(css).toContain('height: var(--ch-size-icon-button);');
        expect(css).toContain('width: var(--ch-size-icon-button);');
        expect(tokensCss).not.toContain('--ch-size-icon-button: calc(');
    });

    it('active transform token is a scale-down (not aliased to hover) for press affordance', () => {
        expect(tokensCss).not.toContain(
            '--ch-button-transform-active: var(--ch-button-transform-hover)',
        );
    });

    it('has a :focus-visible border highlight using design-token references', () => {
        expect(tokensCss).toContain('--ch-focus-ring-width:');
        expect(tokensCss).toContain('--ch-focus-ring-color:');
        expect(css).toContain(':focus-visible');
        expect(css).toContain('border-color: var(--ch-focus-ring-color)');
        // Drawn at the border, never as an offset halo a scroll container
        // could clip into a stray sliver.
        expect(css).not.toContain('var(--ch-focus-ring-offset)');
    });

    it('renders an svg glyph child while keeping the aria-label as the accessible name', () => {
        render(
            <IconButton aria-label="Chat">
                <svg data-testid="glyph" viewBox="0 0 24 24" />
            </IconButton>,
        );

        const button = screen.getByRole('button', { name: 'Chat' });
        expect(button.querySelector('svg')).not.toBeNull();
        // Icon-only control: the accessible name is the button's aria-label; the
        // decorative svg exposes no name of its own.
        expect(screen.queryByRole('img')).toBeNull();
    });

    it('sizes an svg glyph child via a token and colours it via currentColor', () => {
        const svgRule = /\.icon-button svg\s*\{([^}]*)\}/s.exec(css)?.[1];

        expect(svgRule).toBeDefined();
        expect(svgRule).toContain('inline-size: var(--ch-icon-button-glyph-size)');
        expect(svgRule).toContain('block-size: var(--ch-icon-button-glyph-size)');
        expect(svgRule).toContain('fill: currentColor');
        expect(tokensCss).toContain('--ch-icon-button-glyph-size:');
        expect(tokensCss).toContain('--ch-size-icon:');
    });

    it('still sizes non-svg glyph children via font-size (plain text glyphs are unaffected)', () => {
        expect(css).toContain('font-size: var(--ch-icon-button-font-size);');
    });
});
