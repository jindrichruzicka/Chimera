// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Heading } from './Heading';
import css from './Heading.module.css?raw';

function expectTokenizedCss(source: string): void {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const sourceWithoutVariables = source.replace(/var\([^)]+\)/g, '');
    expect(sourceWithoutVariables).not.toMatch(/\b\d+px\b/);
    expect(sourceWithoutVariables).not.toMatch(/line-height:\s*[0-9]/);
}

afterEach(() => {
    cleanup();
});

describe('Heading', () => {
    it('renders semantic h1 through h6 levels', () => {
        const headingLevels = [1, 2, 3, 4, 5, 6] as const;

        render(
            <>
                {headingLevels.map((level) => (
                    <Heading key={level} level={level}>
                        Level {level}
                    </Heading>
                ))}
            </>,
        );

        for (const level of headingLevels) {
            const heading = screen.getByRole('heading', { level, name: `Level ${level}` });

            expect(heading.tagName).toBe(`H${level}`);
        }
    });

    it('keeps semantic level separate from visual size and tone', () => {
        render(
            <Heading level={3} size="xl" tone="muted">
                Round Summary
            </Heading>,
        );

        const heading = screen.getByRole('heading', { level: 3, name: 'Round Summary' });
        expect(heading.tagName).toBe('H3');
        expect(heading).toHaveAttribute('data-ch-heading-level', '3');
        expect(heading).toHaveAttribute('data-ch-heading-size', 'xl');
        expect(heading).toHaveAttribute('data-ch-heading-tone', 'muted');
    });

    it('forwards className and token override styles', () => {
        render(
            <Heading
                className="custom-heading"
                level={2}
                style={{ color: 'var(--ch-color-success)' }}
            >
                Victory
            </Heading>,
        );

        const heading = screen.getByRole('heading', { level: 2, name: 'Victory' });
        expect(heading).toHaveClass('custom-heading');
        expect(heading).toHaveStyle({ color: 'var(--ch-color-success)' });
    });

    it('uses typography tokens for visual variants', () => {
        expectTokenizedCss(css);
        expect(css).toContain('font-family: var(--ch-font-ui);');
        expect(css).toContain('font-size: var(--ch-font-size-xl);');
        expect(css).toContain('color: var(--ch-color-text-primary);');
        expect(css).toContain('color: var(--ch-color-text-secondary);');
    });

    it('paints through the token-driven gradient fill and outline', () => {
        // The heading role tokens default to currentColor stops, so every
        // tone (and inline colour override) keeps rendering its own colour
        // until a game overrides the heading treatment tokens.
        expect(css).toMatch(
            /\.heading\s*\{[^}]*background-image:\s*linear-gradient\(\s*to bottom,\s*var\(--ch-heading-fill-top\),\s*var\(--ch-heading-fill-bottom\)\s*\);/s,
        );
        expect(css).toMatch(/\.heading\s*\{[^}]*background-clip:\s*text;/s);
        expect(css).toMatch(/\.heading\s*\{[^}]*-webkit-text-fill-color:\s*transparent;/s);
        expect(css).toMatch(
            /\.heading\s*\{[^}]*-webkit-text-stroke:\s*var\(--ch-heading-outline-width\)\s*var\(--ch-heading-outline-color\);/s,
        );
    });
});
