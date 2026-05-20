// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

const cssFP = path.resolve(import.meta.dirname, 'IconButton.module.css');
const tokensCssPath = path.resolve(import.meta.dirname, '../../styles/tokens.css');

function readCss(): string {
    return readFileSync(cssFP, 'utf8');
}

function readTokensCss(): string {
    return readFileSync(tokensCssPath, 'utf8');
}

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

    it('CSS does not contain hardcoded colour, spacing, or radius values (invariant #86)', () => {
        const css = readCss();

        // No hex values
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        // No bare pixel values for colour/spacing/radius (allowed only inside var() fallbacks)
        const hardcoded = css.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
        expect(hardcoded).toBeNull();
    });

    it('uses a dedicated active transform token for pressed feedback', () => {
        const css = readCss();
        const tokensCss = readTokensCss();

        expect(tokensCss).toContain('--ch-button-transform-active:');
        expect(css).toContain('transform: var(--ch-button-transform-active);');
    });

    it('uses a discrete icon button size token without fractional calc', () => {
        const tokensCss = readTokensCss();

        expect(tokensCss).toContain('--ch-size-icon-button:');
        expect(tokensCss).toContain('--ch-icon-button-size: var(--ch-size-icon-button);');
        expect(tokensCss).not.toContain('--ch-icon-button-size: calc(var(--ch-space-xl) * 0.9);');
    });

    it('active transform token is a scale-down (not aliased to hover) for press affordance', () => {
        const tokensCss = readTokensCss();

        expect(tokensCss).not.toContain(
            '--ch-button-transform-active: var(--ch-button-transform-hover)',
        );
    });

    it('has a :focus-visible outline using design-token references', () => {
        const css = readCss();
        const tokensCss = readTokensCss();

        expect(tokensCss).toContain('--ch-focus-ring-width:');
        expect(tokensCss).toContain('--ch-focus-ring-color:');
        expect(css).toContain(':focus-visible');
        expect(css).toContain('outline:');
    });
});
