// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberInput } from './NumberInput';
import css from './NumberInput.module.css?raw';

function expectTokenizedCss(source: string): void {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const hardcodedPixels = source.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
    expect(hardcodedPixels).toBeNull();
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('NumberInput', () => {
    it('renders a labelled numeric input with constraints', () => {
        render(<NumberInput label="AI turns" max={12} min={1} step={1} value={4} />);

        const input = screen.getByRole('spinbutton', { name: 'AI turns' });
        expect(input).toHaveAttribute('min', '1');
        expect(input).toHaveAttribute('max', '12');
        expect(input).toHaveAttribute('step', '1');
        expect(input).toHaveValue(4);
    });

    it('forwards numeric values when changed', async () => {
        const onValueChange = vi.fn();

        render(
            <NumberInput
                label="Camera speed"
                max={10}
                min={0}
                onValueChange={onValueChange}
                step={0.5}
                value={2}
            />,
        );

        const input = screen.getByRole('spinbutton', { name: 'Camera speed' });
        fireEvent.change(input, { target: { value: '4.5' } });

        expect(onValueChange).toHaveBeenCalledWith(4.5);
    });

    it('does not forward changes while disabled', async () => {
        const user = userEvent.setup();
        const onValueChange = vi.fn();

        render(
            <NumberInput
                disabled
                label="Camera speed"
                max={10}
                min={0}
                onValueChange={onValueChange}
                step={0.5}
                value={2}
            />,
        );

        const input = screen.getByRole('spinbutton', { name: 'Camera speed' });
        expect(input).toBeDisabled();

        await user.click(input);
        await user.keyboard('4.5');

        expect(onValueChange).not.toHaveBeenCalled();
    });

    it('connects helper and error text and exposes invalid state', () => {
        render(
            <NumberInput
                error="Use a value from 1 to 12."
                helperText="Whole turns only."
                invalid
                label="AI turns"
                max={12}
                min={1}
                step={1}
                value={18}
            />,
        );

        const input = screen.getByRole('spinbutton', { name: 'AI turns' });
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription('Whole turns only. Use a value from 1 to 12.');
    });

    it('does not call onValueChange when the input is cleared', () => {
        const onValueChange = vi.fn();

        render(
            <NumberInput
                label="Camera speed"
                max={10}
                min={0}
                onValueChange={onValueChange}
                step={0.5}
                value={2}
            />,
        );

        const input = screen.getByRole('spinbutton', { name: 'Camera speed' });
        fireEvent.change(input, { target: { value: '' } });

        expect(onValueChange).not.toHaveBeenCalled();
    });

    it('respects an explicit id prop and wires the label accordingly', () => {
        render(<NumberInput id="my-input" label="Custom id" max={10} min={0} step={1} value={5} />);

        const input = screen.getByRole('spinbutton', { name: 'Custom id' });
        expect(input).toHaveAttribute('id', 'my-input');
    });

    it('uses tokenized CSS for default, invalid, focus, and disabled states', () => {
        expectTokenizedCss(css);
        expect(css).toContain("[data-invalid='true']");
        expect(css).toContain(':focus-visible');
        expect(css).toContain('var(--ch-color-error)');
        expect(css).toContain('var(--ch-color-text-disabled)');
    });
});
