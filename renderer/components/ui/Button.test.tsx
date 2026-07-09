// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import buttonCss from './Button.module.css?raw';

function renderButton(button: React.ReactElement): void {
    render(button);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Button', () => {
    it('renders children', () => {
        renderButton(<Button>Play</Button>);

        expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });

    it('defaults to type="button" and the primary variant', () => {
        renderButton(<Button data-testid="default-button">Default</Button>);

        const button = screen.getByTestId('default-button');
        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveAttribute('data-ch-button-variant', 'primary');
        expect(button).toHaveAttribute('data-ch-button-size', 'md');
    });

    it('applies variant classes', () => {
        renderButton(
            <Button data-testid="secondary-button" variant="secondary">
                Settings
            </Button>,
        );

        const button = screen.getByTestId('secondary-button');
        expect(button.className).toContain('button');
        expect(button.className).toContain('secondary');
        expect(button).toHaveAttribute('data-ch-button-variant', 'secondary');
    });

    it('changes classes when size changes', () => {
        render(
            <>
                <Button data-testid="medium-button">Default Size</Button>
                <Button data-testid="large-button" size="lg">
                    Large Size
                </Button>
            </>,
        );

        const mediumButton = screen.getByTestId('medium-button');
        const largeButton = screen.getByTestId('large-button');

        expect(mediumButton.className).toContain('md');
        expect(largeButton.className).toContain('lg');
        expect(largeButton.className).not.toBe(mediumButton.className);
    });

    it('renders all semantic variants for shell actions', () => {
        render(
            <>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
            </>,
        );

        expect(screen.getByRole('button', { name: 'Primary' })).toHaveAttribute(
            'data-ch-button-variant',
            'primary',
        );
        expect(screen.getByRole('button', { name: 'Secondary' })).toHaveAttribute(
            'data-ch-button-variant',
            'secondary',
        );
        expect(screen.getByRole('button', { name: 'Ghost' })).toHaveAttribute(
            'data-ch-button-variant',
            'ghost',
        );
        expect(screen.getByRole('button', { name: 'Danger' })).toHaveAttribute(
            'data-ch-button-variant',
            'danger',
        );
    });

    it('prevents clicks when disabled', () => {
        const onClick = vi.fn();

        renderButton(
            <Button disabled onClick={onClick}>
                Disabled
            </Button>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Disabled' }));

        expect(onClick).not.toHaveBeenCalled();
    });

    it('preserves button events and consumer-supplied token override styles', () => {
        const onClick = vi.fn();

        renderButton(
            <Button
                variant="secondary"
                onClick={onClick}
                style={{ width: 'var(--ch-button-width)' }}
            >
                Settings
            </Button>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expect(onClick).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveStyle({
            width: 'var(--ch-button-width)',
        });
    });

    it('uses tokenized pill shape, elevation, and hover motion styles', () => {
        const css = buttonCss;

        expect(css).toContain('border-radius: var(--ch-button-radius);');
        expect(css).toContain('box-shadow: var(--ch-button-shadow);');
        expect(css).toContain('transform: var(--ch-button-transform);');
        expect(css).toContain('.button:not(:disabled):hover');
        expect(css).toContain('border-color: var(--ch-button-hover-border-color);');
        expect(css).toContain('box-shadow: var(--ch-button-shadow-hover);');
        expect(css).toContain('transform: var(--ch-button-transform-hover);');
    });

    it('renders the ghost variant as plain text without panel chrome', () => {
        const css = buttonCss;

        expect(css).toMatch(
            /\.ghost\s*{[^}]*--ch-button-shadow:\s*var\(--ch-button-shadow-ghost\);[^}]*--ch-button-shadow-hover:\s*var\(--ch-button-shadow-hover-ghost\);/s,
        );
        // Disabled must keep the ghost border token instead of restoring the
        // shared grey border, so a disabled ghost stays text-only.
        expect(css).toMatch(
            /\.ghost:disabled\s*{[^}]*border-color:\s*var\(--ch-button-border-ghost\);/s,
        );
        expect(css.indexOf('.ghost:disabled')).toBeGreaterThan(css.indexOf('.button:disabled'));
    });

    it('uses the dedicated active transform token for pressed feedback', () => {
        const css = buttonCss;

        expect(css).toContain('.button:not(:disabled):active');
        expect(css).toMatch(
            /\.button:not\(:disabled\):active\s*{[^}]*transform:\s*var\(--ch-button-transform-active\);/s,
        );
        // Source order: the :active rule must come after :hover so the press
        // transform wins at equal specificity while the pointer is down.
        expect(css.indexOf('.button:not(:disabled):active')).toBeGreaterThan(
            css.indexOf('.button:not(:disabled):hover'),
        );
    });

    it('maps each size class to tokenized typography and spacing', () => {
        const css = buttonCss;

        expect(css).toMatch(
            /\.sm\s*{[^}]*--ch-button-font-size:\s*var\(--ch-button-font-size-sm\);[^}]*--ch-button-line-height:\s*var\(--ch-button-line-height-sm\);[^}]*--ch-button-padding:\s*var\(--ch-button-padding-sm\);/s,
        );
        expect(css).toMatch(
            /\.md\s*{[^}]*--ch-button-font-size:\s*var\(--ch-button-font-size-md\);[^}]*--ch-button-line-height:\s*var\(--ch-button-line-height-md\);[^}]*--ch-button-padding:\s*var\(--ch-button-padding-md\);/s,
        );
        expect(css).toMatch(
            /\.lg\s*{[^}]*--ch-button-font-size:\s*var\(--ch-button-font-size-lg\);[^}]*--ch-button-line-height:\s*var\(--ch-button-line-height-lg\);[^}]*--ch-button-padding:\s*var\(--ch-button-padding-lg\);/s,
        );
    });
});
