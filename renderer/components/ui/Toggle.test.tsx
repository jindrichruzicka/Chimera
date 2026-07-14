// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle';
import css from './Toggle.module.css?raw';

function expectTokenizedCss(source: string): void {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const hardcodedPixels = source.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
    expect(hardcodedPixels).toBeNull();
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Toggle', () => {
    it('renders a labelled switch with checked semantics', () => {
        render(<Toggle checked label="Music enabled" />);

        const toggle = screen.getByRole('switch', { name: 'Music enabled' });
        expect(toggle).toBeChecked();
        expect(toggle).toHaveAttribute('data-checked', 'true');
    });

    it('forwards the next checked state when changed', async () => {
        const user = userEvent.setup();
        const onCheckedChange = vi.fn();

        render(<Toggle checked={false} label="Show grid" onCheckedChange={onCheckedChange} />);

        await user.click(screen.getByRole('switch', { name: 'Show grid' }));

        expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('does not forward changes while disabled', async () => {
        const user = userEvent.setup();
        const onCheckedChange = vi.fn();

        render(
            <Toggle
                checked={false}
                disabled
                label="Enable assists"
                onCheckedChange={onCheckedChange}
            />,
        );

        const toggle = screen.getByRole('switch', { name: 'Enable assists' });
        expect(toggle).toBeDisabled();

        await user.click(toggle);

        expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it('connects helper text as the accessible description', () => {
        render(
            <Toggle
                checked={false}
                helperText="Applies to newly opened panels."
                label="Compact panels"
            />,
        );

        expect(screen.getByRole('switch', { name: 'Compact panels' })).toHaveAccessibleDescription(
            'Applies to newly opened panels.',
        );
    });

    it('respects an explicit id prop and wires the label accordingly', () => {
        render(<Toggle checked id="my-toggle" label="Custom id" />);

        const toggle = screen.getByRole('switch', { name: 'Custom id' });
        expect(toggle).toHaveAttribute('id', 'my-toggle');
    });

    it('uses tokenized CSS for visual states', () => {
        expectTokenizedCss(css);
        expect(css).toContain("[data-checked='true']");
        expect(css).toContain(':focus-visible');
        expect(css).toContain('var(--ch-color-accent)');
        expect(css).toContain('var(--ch-color-text-disabled)');
    });

    it('cues hover on the enabled track by strengthening its border, like text fields do', () => {
        const hoverRule =
            /\.input:where\(:hover:not\(:disabled\)\)\s*~\s*\.track\s*\{[^}]*\}/s.exec(css)?.[0] ??
            '';

        expect(hoverRule).toContain('border-color: var(--ch-color-border-strong)');
        // The checked track keeps its accent border: the higher-specificity
        // [data-checked='true'] rule must still beat the :where()-wrapped hover.
        expect(css).toContain("[data-checked='true'] .track");
    });

    it('sizes the label to match the compact input-field label size', () => {
        const labelRule = /\.label\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(labelRule).toContain('font-size: var(--ch-font-size-sm)');
        expect(labelRule).not.toContain('var(--ch-font-size-md)');
    });
});
