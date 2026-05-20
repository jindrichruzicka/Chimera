// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Card } from './Card';

const cardCssPath = path.resolve(import.meta.dirname, 'Card.module.css');

function readCardCss(): string {
    return readFileSync(cardCssPath, 'utf8');
}

afterEach(() => {
    cleanup();
});

describe('Card', () => {
    it('renders children inside the requested semantic element', () => {
        render(
            <Card as="article" data-testid="status-card">
                Mission summary
            </Card>,
        );

        const card = screen.getByTestId('status-card');
        expect(card.tagName).toBe('ARTICLE');
        expect(card).toHaveTextContent('Mission summary');
    });

    it('defaults to a div with surface, medium padding, and small elevation variants', () => {
        render(<Card data-testid="default-card">Default card</Card>);

        const card = screen.getByTestId('default-card');
        expect(card.tagName).toBe('DIV');
        expect(card).toHaveAttribute('data-ch-card-surface', 'surface');
        expect(card).toHaveAttribute('data-ch-card-padding', 'md');
        expect(card).toHaveAttribute('data-ch-card-elevation', 'sm');
    });

    it('selects variant classes for surface, elevation, and padding', () => {
        render(
            <Card data-testid="variant-card" elevation="lg" padding="sm" surface="overlay">
                Tactical readout
            </Card>,
        );

        const card = screen.getByTestId('variant-card');
        expect(card.className).toContain('overlay');
        expect(card.className).toContain('elevationLg');
        expect(card.className).toContain('paddingSm');
        expect(card).toHaveAttribute('data-ch-card-surface', 'overlay');
        expect(card).toHaveAttribute('data-ch-card-padding', 'sm');
        expect(card).toHaveAttribute('data-ch-card-elevation', 'lg');
    });

    it('forwards className and data attributes safely', () => {
        render(
            <Card className="custom-card" data-card-id="alpha" data-testid="custom-card">
                Custom card
            </Card>,
        );

        const card = screen.getByTestId('custom-card');
        expect(card).toHaveClass('custom-card');
        expect(card).toHaveAttribute('data-card-id', 'alpha');
    });

    it('styles variants with design-token references only', () => {
        const source = readCardCss();

        expect(source).toContain('background-color: var(--ch-color-surface);');
        expect(source).toContain('background-color: var(--ch-color-surface-raised);');
        expect(source).toContain('background-color: var(--ch-color-surface-overlay);');
        expect(source).toContain('box-shadow: var(--ch-shadow-lg);');
        expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(source).not.toMatch(/\brgba?\s*\(/iu);
        expect(source).not.toMatch(/\bhsla?\s*\(/iu);
        expect(source.replace(/var\([^)]+\)/g, '')).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem)\b/);
    });
});
