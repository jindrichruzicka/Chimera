// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Caption } from './Caption';
import css from './Caption.module.css?raw';

function expectTokenizedCss(source: string): void {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const sourceWithoutVariables = source.replace(/var\([^)]+\)/g, '');
    expect(sourceWithoutVariables).not.toMatch(/\b\d+px\b/);
    expect(sourceWithoutVariables).not.toMatch(/line-height:\s*[0-9]/);
}

afterEach(() => {
    cleanup();
});

describe('Caption', () => {
    it('renders compact supporting text as a paragraph by default', () => {
        render(<Caption>Autosave every five turns.</Caption>);

        const caption = screen.getByText('Autosave every five turns.');
        expect(caption.tagName).toBe('P');
        expect(caption).toHaveAttribute('data-ch-caption-tone', 'neutral');
    });

    it('renders tone variants with semantic markers', () => {
        render(
            <>
                <Caption tone="neutral">Neutral</Caption>
                <Caption tone="muted">Muted</Caption>
                <Caption tone="error">Error</Caption>
                <Caption tone="success">Success</Caption>
            </>,
        );

        expect(screen.getByText('Neutral')).toHaveAttribute('data-ch-caption-tone', 'neutral');
        expect(screen.getByText('Muted')).toHaveAttribute('data-ch-caption-tone', 'muted');
        expect(screen.getByText('Error')).toHaveAttribute('data-ch-caption-tone', 'error');
        expect(screen.getByText('Success')).toHaveAttribute('data-ch-caption-tone', 'success');
    });

    it('can describe form fields through a stable id', () => {
        render(
            <>
                <input aria-describedby="unit-helper" aria-label="Unit name" />
                <Caption className="custom-caption" id="unit-helper" tone="muted">
                    Visible to squadmates.
                </Caption>
            </>,
        );

        const input = screen.getByRole('textbox', { name: 'Unit name' });
        const caption = screen.getByText('Visible to squadmates.');
        expect(caption).toHaveAttribute('id', 'unit-helper');
        expect(caption).toHaveClass('custom-caption');
        expect(input).toHaveAccessibleDescription('Visible to squadmates.');
    });

    it('forwards token override styles', () => {
        render(
            <Caption style={{ color: 'var(--ch-color-error-text)' }} tone="error">
                Missing field.
            </Caption>,
        );

        expect(screen.getByText('Missing field.')).toHaveStyle({
            color: 'var(--ch-color-error-text)',
        });
    });

    it('uses tokenized typography and tone styles', () => {
        expectTokenizedCss(css);
        expect(css).toContain('font-family: var(--ch-font-ui);');
        expect(css).toContain('font-size: var(--ch-font-size-sm);');
        expect(css).toContain('color: var(--ch-color-text-primary);');
        expect(css).toContain('color: var(--ch-color-text-secondary);');
        expect(css).toContain('color: var(--ch-color-error-text);');
        expect(css).toContain('color: var(--ch-color-success);');
    });

    it('paints through the token-driven gradient fill and outline', () => {
        expect(css).toMatch(
            /\.caption\s*\{[^}]*background-image:\s*linear-gradient\(\s*to bottom,\s*var\(--ch-caption-fill-top\),\s*var\(--ch-caption-fill-bottom\)\s*\);/s,
        );
        expect(css).toMatch(/\.caption\s*\{[^}]*background-clip:\s*text;/s);
        expect(css).toMatch(/\.caption\s*\{[^}]*-webkit-text-fill-color:\s*transparent;/s);
        expect(css).toMatch(
            /\.caption\s*\{[^}]*-webkit-text-stroke:\s*var\(--ch-caption-outline-width\)\s*var\(--ch-caption-outline-color\);/s,
        );
    });

    it('keeps error and success tones plain even when the treatment is themed', () => {
        // Validation feedback must always render its semantic colour: the
        // decorative treatment never overrides error/success captions.
        expect(css).toMatch(/\.error\s*\{[^}]*background-image:\s*none;/s);
        expect(css).toMatch(/\.error\s*\{[^}]*-webkit-text-fill-color:\s*currentColor;/s);
        expect(css).toMatch(/\.error\s*\{[^}]*-webkit-text-stroke-width:\s*0;/s);
        expect(css).toMatch(/\.success\s*\{[^}]*background-image:\s*none;/s);
        expect(css).toMatch(/\.success\s*\{[^}]*-webkit-text-fill-color:\s*currentColor;/s);
        expect(css).toMatch(/\.success\s*\{[^}]*-webkit-text-stroke-width:\s*0;/s);
    });
});
