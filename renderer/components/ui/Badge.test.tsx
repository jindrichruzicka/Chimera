// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import badgeCss from './Badge.module.css?raw';

afterEach(() => {
    cleanup();
});

function extractRule(className: string): string {
    return new RegExp(`\\.${className}\\s*\\{[^}]*\\}`, 's').exec(badgeCss)?.[0] ?? '';
}

describe('Badge', () => {
    it('renders status text with a semantic variant marker', () => {
        render(<Badge variant="success">Ready</Badge>);

        expect(screen.getByText('Ready')).toHaveAttribute('data-ch-badge-variant', 'success');
    });

    it.each(['success', 'warning', 'error'] as const)(
        'tints the %s variant from its state surface, text, and border tokens',
        (state) => {
            const rule = extractRule(state);

            expect(rule).toContain(`background-color: var(--ch-color-${state}-surface)`);
            expect(rule).toContain(`var(--ch-color-${state}-text)`);
            expect(rule).toContain(`var(--ch-color-${state}-border)`);
        },
    );

    it('styles the neutral variant as an overlay chip with a strong border', () => {
        const rule = extractRule('neutral');

        expect(rule).toContain('background-color: var(--ch-color-surface-overlay)');
        expect(rule).toContain('var(--ch-color-text-secondary)');
        expect(rule).toContain('var(--ch-color-border-strong)');
    });

    it('draws every variant border at the sm border width token', () => {
        const badgeRule = extractRule('badge');

        expect(badgeRule).toContain('border-style: solid');
        expect(badgeRule).toContain('border-width: var(--ch-border-width-sm)');
    });

    it('no longer paints solid state fills or the surface-as-text warning hack', () => {
        expect(badgeCss).not.toContain('background-color: var(--ch-color-success);');
        expect(badgeCss).not.toContain('background-color: var(--ch-color-warning);');
        expect(badgeCss).not.toContain('background-color: var(--ch-color-error);');
        expect(badgeCss).not.toContain('var(--ch-color-surface);');
    });
});
