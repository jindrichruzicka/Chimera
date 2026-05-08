// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultTheme } from '../../theme/default-theme';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Button } from './Button';

function renderButton(button: React.ReactElement): void {
    render(<ThemeProvider>{button}</ThemeProvider>);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Button', () => {
    it('renders the primary variant with the default engine palette styles', () => {
        renderButton(<Button variant="primary">Play</Button>);

        const playButton = screen.getByRole('button', { name: 'Play' });
        expect(playButton.getAttribute('style')).toContain(
            `background-color: ${defaultTheme.palette.button.variants.primary.backgroundColor}`,
        );
        expect(playButton.getAttribute('style')).toContain(
            `border-color: ${defaultTheme.palette.button.variants.primary.borderColor}`,
        );
        expect(playButton.getAttribute('style')).toContain(
            `color: ${defaultTheme.palette.button.variants.primary.color}`,
        );
    });

    it('defaults to type="button" and the primary variant', () => {
        renderButton(<Button data-testid="default-button">Default</Button>);

        const button = screen.getByTestId('default-button');
        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveAttribute('data-ch-button-variant', 'primary');
        expect(button).toHaveAttribute('data-ch-button-size', 'md');
    });

    it('applies non-default size styles from the theme palette', () => {
        render(
            <ThemeProvider>
                <Button data-testid="medium-button">Default Size</Button>
                <Button data-testid="large-button" size="lg">
                    Large Size
                </Button>
            </ThemeProvider>,
        );

        const mediumButton = screen.getByTestId('medium-button');
        const largeButton = screen.getByTestId('large-button');

        expect(mediumButton.getAttribute('style')).toContain(
            `padding: ${defaultTheme.palette.button.sizes.md.padding}`,
        );
        expect(largeButton.getAttribute('style')).toContain(
            `padding: ${defaultTheme.palette.button.sizes.lg.padding}`,
        );
        expect(largeButton.getAttribute('style')).toContain(
            `min-width: ${defaultTheme.palette.button.sizes.lg.minWidth}`,
        );
        expect(largeButton.getAttribute('style')).not.toBe(mediumButton.getAttribute('style'));
    });

    it('renders all semantic variants for shell actions', () => {
        render(
            <ThemeProvider>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
            </ThemeProvider>,
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
});
