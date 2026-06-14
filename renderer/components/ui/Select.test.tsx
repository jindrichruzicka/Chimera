// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function extractDeclarations(source: string, selector: string): string {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(source);

    if (match?.[1] === undefined) {
        throw new Error(`Missing rule for selector "${selector}"`);
    }

    return match[1];
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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

    it('keeps the label as the accessible name while visually hiding it when hideLabel is set', () => {
        render(<Select hideLabel label="Player colour" options={qualityOptions} value="low" />);

        // The accessible name is still provided by the (now hidden) label.
        const select = screen.getByRole('combobox', { name: 'Player colour' });
        expect(select).toBeInTheDocument();

        // The label element is rendered but carries the visually-hidden class.
        const label = screen.getByText('Player colour');
        expect(label.className).toContain('labelHidden');
    });

    it('renders the label visibly by default', () => {
        render(<Select label="Texture quality" options={qualityOptions} value="low" />);

        const label = screen.getByText('Texture quality');
        expect(label.className).not.toContain('labelHidden');
    });

    it('defines a tokenized, visually-hidden label rule', () => {
        const labelHidden = extractDeclarations(css, '.labelHidden');
        expect(labelHidden).toContain('position: absolute');
        expect(labelHidden).toContain('overflow: hidden');
        expect(labelHidden).toContain('var(--ch-space-screen-reader)');
        expectTokenizedCss(css);
    });

    it('uses tokenized CSS for default, invalid, focus, and disabled states', () => {
        expectTokenizedCss(css);
        expect(css).toContain("[data-invalid='true']");
        expect(css).toContain(':focus-visible');
        expect(css).toContain('var(--ch-color-error)');
        expect(css).toContain('var(--ch-color-text-disabled)');
    });

    it('anchors the popup from a custom border-box styled trigger', () => {
        expect(css).toContain('appearance: none');
        expect(css).toContain('.controlShell::after');
        expect(css).toContain('padding-inline-end');
        expect(css).not.toContain('appearance: auto');
    });

    it('keeps the native popup anchor flush with the trigger edge', () => {
        // Inline-start padding and transforms on the <select> make Chromium
        // auto-dismiss the macOS native popup ~1s after it opens — only
        // margin/width/clip-path may shape the anchor box.
        expect(css).toContain('padding-inline-start: 0');
        expect(extractDeclarations(css, '.control')).not.toContain('transform:');
        expect(css).toContain('text-indent: calc(var(--ch-space-sm) + var(--ch-space-xs))');
        expect(css).not.toContain('padding-inline: var(--ch-space-md)');
    });

    it('draws the field chrome on the shell so the popup can align with the visible box', () => {
        const shell = extractDeclarations(css, '.controlShell');
        expect(shell).toContain('background-color: var(--ch-color-surface-raised)');
        expect(shell).toContain('border-width: var(--ch-border-width-sm)');
        expect(shell).toContain('border-radius: var(--ch-radius-md)');

        const control = extractDeclarations(css, '.control');
        expect(control).toContain('background-color: var(--ch-color-transparent)');
        expect(control).toContain('border: none');
    });

    it('contains the macOS anchor overhang inside the shell so it leaks no scrollable overflow', () => {
        // The macOS anchor hack widens the <select> past the shell's inline-end
        // edge; clip-path hides the paint but NOT the scrollable overflow, so
        // without containment every scrollable ancestor grows a phantom
        // horizontal scrollbar.
        expect(extractDeclarations(css, '.controlShell')).toContain('overflow: hidden');
    });

    it('offsets the select border-box on macOS so the native menu lands on the visible box', () => {
        const macControl = extractDeclarations(
            css,
            ".root[data-popup-anchor='macos'] .control",
        ).replace(/\s+/g, ' ');
        expect(macControl).toContain('margin-inline-start: var(--ch-select-popup-overhang-mac)');
        expect(macControl).toContain(
            'inline-size: calc( 100% - var(--ch-select-popup-overhang-mac) + var(--ch-select-popup-shortfall-mac) )',
        );
        expect(macControl).toContain(
            'clip-path: inset(0 var(--ch-select-popup-shortfall-mac) 0 0)',
        );
        expect(macControl).toContain('text-indent: 0');
    });

    it('marks the root with the macOS popup anchor flag after hydration on a Mac', async () => {
        vi.stubGlobal('navigator', { ...window.navigator, platform: 'MacIntel' });

        const { container } = render(
            <Select label="Texture quality" options={qualityOptions} value="medium" />,
        );

        await waitFor(() => {
            expect(container.firstElementChild).toHaveAttribute('data-popup-anchor', 'macos');
        });
    });

    it('leaves the popup anchor flag off on non-Mac platforms', () => {
        vi.stubGlobal('navigator', { ...window.navigator, platform: 'Win32' });

        const { container } = render(
            <Select label="Texture quality" options={qualityOptions} value="medium" />,
        );

        expect(container.firstElementChild).not.toHaveAttribute('data-popup-anchor');
    });

    it('forwards shell clicks left of the inset select to the picker on a Mac', async () => {
        vi.stubGlobal('navigator', { ...window.navigator, platform: 'MacIntel' });

        render(<Select label="Texture quality" options={qualityOptions} value="medium" />);

        const select = screen.getByRole('combobox', { name: 'Texture quality' });
        const showPicker = vi.fn();
        Object.defineProperty(select, 'showPicker', { configurable: true, value: showPicker });
        const shell = select.parentElement!;

        fireEvent.pointerDown(shell);

        await waitFor(() => expect(showPicker).toHaveBeenCalledTimes(1));
        expect(select).toHaveFocus();
    });

    it('leaves pointer-downs on the select itself to the native popup handling', () => {
        vi.stubGlobal('navigator', { ...window.navigator, platform: 'MacIntel' });

        render(<Select label="Texture quality" options={qualityOptions} value="medium" />);

        const select = screen.getByRole('combobox', { name: 'Texture quality' });
        const showPicker = vi.fn();
        Object.defineProperty(select, 'showPicker', { configurable: true, value: showPicker });

        fireEvent.pointerDown(select);

        expect(showPicker).not.toHaveBeenCalled();
    });

    it('does not open the picker from the shell while disabled', () => {
        vi.stubGlobal('navigator', { ...window.navigator, platform: 'MacIntel' });

        render(<Select disabled label="Texture quality" options={qualityOptions} value="medium" />);

        const select = screen.getByRole('combobox', { name: 'Texture quality' });
        const showPicker = vi.fn();
        Object.defineProperty(select, 'showPicker', { configurable: true, value: showPicker });

        fireEvent.pointerDown(select.parentElement!);

        expect(showPicker).not.toHaveBeenCalled();
        expect(select).not.toHaveFocus();
    });
});
