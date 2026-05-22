// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextInput } from './TextInput';
import css from './TextInput.module.css?raw';

function expectTokenizedCss(source: string): void {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const hardcodedPixels = source.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
    expect(hardcodedPixels).toBeNull();
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('TextInput', () => {
    it('renders a labelled text input with the controlled value', () => {
        render(<TextInput label="Commander name" placeholder="Enter name" value="Ada" />);

        const input = screen.getByRole('textbox', { name: 'Commander name' });
        expect(input).toHaveAttribute('placeholder', 'Enter name');
        expect(input).toHaveValue('Ada');
    });

    it('forwards text values when changed', () => {
        const onValueChange = vi.fn();

        render(<TextInput label="Commander name" onValueChange={onValueChange} value="Ada" />);

        const input = screen.getByRole('textbox', { name: 'Commander name' });
        fireEvent.change(input, { target: { value: 'Grace' } });

        expect(onValueChange).toHaveBeenCalledWith('Grace');
    });

    it('does not forward changes while disabled', async () => {
        const user = userEvent.setup();
        const onValueChange = vi.fn();

        render(
            <TextInput disabled label="Commander name" onValueChange={onValueChange} value="Ada" />,
        );

        const input = screen.getByRole('textbox', { name: 'Commander name' });
        expect(input).toBeDisabled();

        await user.click(input);
        await user.keyboard('Grace');

        expect(onValueChange).not.toHaveBeenCalled();
    });

    it('connects helper and error text and exposes invalid state', () => {
        render(
            <TextInput
                error="Use at least three characters."
                helperText="Shown in the lobby."
                invalid
                label="Commander name"
                value="Al"
            />,
        );

        const input = screen.getByRole('textbox', { name: 'Commander name' });
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription(
            'Shown in the lobby. Use at least three characters.',
        );
    });

    it('respects an explicit id prop and wires the label accordingly', () => {
        render(<TextInput id="my-text-input" label="Custom id" value="Ada" />);

        const input = screen.getByRole('textbox', { name: 'Custom id' });
        expect(input).toHaveAttribute('id', 'my-text-input');
    });

    it('uses tokenized CSS for sizing, default, invalid, focus, and disabled states', () => {
        expectTokenizedCss(css);
        expect(css).toContain('box-sizing: border-box');
        expect(css).toContain('min-inline-size: 0');
        expect(css).toContain("[data-invalid='true']");
        expect(css).toContain(':focus-visible');
        expect(css).toContain('var(--ch-color-error)');
        expect(css).toContain('var(--ch-color-text-disabled)');
    });
});
