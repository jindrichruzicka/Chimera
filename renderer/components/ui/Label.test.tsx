// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Label } from './Label';
import css from './Label.module.css?raw';

function expectTokenizedCss(source: string): void {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const sourceWithoutVariables = source.replace(/var\([^)]+\)/g, '');
    expect(sourceWithoutVariables).not.toMatch(/\b\d+px\b/);
    expect(sourceWithoutVariables).not.toMatch(/line-height:\s*[0-9]/);
}

afterEach(() => {
    cleanup();
});

describe('Label', () => {
    it('associates text with a form control through htmlFor', () => {
        render(
            <>
                <Label htmlFor="pilot-name">Pilot name</Label>
                <input id="pilot-name" />
            </>,
        );

        expect(screen.getByLabelText('Pilot name')).toHaveAttribute('id', 'pilot-name');
    });

    it('exposes required state without changing the accessible label name', () => {
        render(
            <>
                <Label data-testid="callsign-label" htmlFor="callsign" required>
                    Callsign
                </Label>
                <input id="callsign" />
            </>,
        );

        const label = screen.getByTestId('callsign-label');
        expect(screen.getByLabelText('Callsign')).toHaveAttribute('id', 'callsign');
        expect(label).toHaveAttribute('data-ch-label-state', 'required');
        expect(label.className).toContain('required');
    });

    it('exposes optional state without changing the accessible label name', () => {
        render(
            <>
                <Label data-testid="alias-label" htmlFor="alias" optional>
                    Alias
                </Label>
                <input id="alias" />
            </>,
        );

        const label = screen.getByTestId('alias-label');
        expect(screen.getByLabelText('Alias')).toHaveAttribute('id', 'alias');
        expect(label).toHaveAttribute('data-ch-label-state', 'optional');
        expect(label.className).toContain('optional');
    });

    it('forwards disabled state, className, and token override styles', () => {
        render(
            <Label
                className="custom-label"
                disabled
                htmlFor="disabled-field"
                style={{ color: 'var(--ch-color-text-disabled)' }}
            >
                Disabled field
            </Label>,
        );

        const label = screen.getByText('Disabled field');
        expect(label).toHaveAttribute('aria-disabled', 'true');
        expect(label).toHaveAttribute('data-disabled', 'true');
        expect(label).toHaveClass('custom-label');
        expect(label).toHaveStyle({ color: 'var(--ch-color-text-disabled)' });
    });

    it('uses tokenized typography and disabled styles', () => {
        expectTokenizedCss(css);
        expect(css).toContain('font-family: var(--ch-font-ui);');
        expect(css).toContain('font-size: var(--ch-font-size-sm);');
        expect(css).toContain('color: var(--ch-color-text-primary);');
        expect(css).toContain("content: '*';");
        expect(css).toContain("content: 'optional';");
        expect(css).toContain(".label[data-disabled='true']");
        expect(css).toContain('color: var(--ch-color-text-disabled);');
    });
});
