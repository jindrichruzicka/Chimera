// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from './Select';
import css from './Select.module.css?raw';

const qualityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
] as const;

function expectTokenizedCss(source: string): void {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const hardcodedPixels = source.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
    expect(hardcodedPixels).toBeNull();
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Select', () => {
    it('renders options with the controlled value selected', () => {
        render(<Select label="Texture quality" options={qualityOptions} value="medium" />);

        const select = screen.getByRole('combobox', { name: 'Texture quality' });
        expect(select).toHaveValue('medium');
        expect(screen.getByRole('option', { name: 'Low' })).toHaveValue('low');
        expect(screen.getByRole('option', { name: 'High' })).toHaveValue('high');
    });

    it('forwards the selected option value when changed', async () => {
        const user = userEvent.setup();
        const onValueChange = vi.fn();

        render(
            <Select
                label="Texture quality"
                onValueChange={onValueChange}
                options={qualityOptions}
                value="medium"
            />,
        );

        await user.selectOptions(screen.getByRole('combobox', { name: 'Texture quality' }), 'high');

        expect(onValueChange).toHaveBeenCalledWith('high');
    });

    it('does not forward changes while disabled', async () => {
        const user = userEvent.setup();
        const onValueChange = vi.fn();

        render(
            <Select
                disabled
                label="Texture quality"
                onValueChange={onValueChange}
                options={qualityOptions}
                value="medium"
            />,
        );

        const select = screen.getByRole('combobox', { name: 'Texture quality' });
        expect(select).toBeDisabled();

        await user.selectOptions(select, 'high');

        expect(onValueChange).not.toHaveBeenCalled();
    });

    it('connects helper and error text and exposes invalid state', () => {
        render(
            <Select
                error="Choose a supported mode."
                helperText="Can be changed between matches."
                invalid
                label="Display mode"
                options={[
                    { value: 'windowed', label: 'Windowed' },
                    { value: 'fullscreen', label: 'Fullscreen' },
                ]}
                value="windowed"
            />,
        );

        const select = screen.getByRole('combobox', { name: 'Display mode' });
        expect(select).toHaveAttribute('aria-invalid', 'true');
        expect(select).toHaveAccessibleDescription(
            'Can be changed between matches. Choose a supported mode.',
        );
    });

    it('marks disabled options as unavailable', () => {
        render(
            <Select
                label="Display mode"
                options={[
                    { value: 'windowed', label: 'Windowed' },
                    { value: 'exclusive', label: 'Exclusive fullscreen', disabled: true },
                ]}
                value="windowed"
            />,
        );

        expect(screen.getByRole('option', { name: 'Exclusive fullscreen' })).toBeDisabled();
    });

    it('respects an explicit id prop and wires the label accordingly', () => {
        render(<Select id="my-select" label="Custom id" options={qualityOptions} value="low" />);

        const select = screen.getByRole('combobox', { name: 'Custom id' });
        expect(select).toHaveAttribute('id', 'my-select');
    });

    it('uses tokenized CSS for default, invalid, focus, and disabled states', () => {
        expectTokenizedCss(css);
        expect(css).toContain("[data-invalid='true']");
        expect(css).toContain(':focus-visible');
        expect(css).toContain('var(--ch-color-error)');
        expect(css).toContain('var(--ch-color-text-disabled)');
    });
});
