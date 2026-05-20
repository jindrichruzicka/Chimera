// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToggleButton } from './ToggleButton';

const cssFP = path.resolve(import.meta.dirname, 'ToggleButton.module.css');
const tokensCssPath = path.resolve(import.meta.dirname, '../../styles/tokens.css');

function readCss(): string {
    return readFileSync(cssFP, 'utf8');
}

function readTokensCss(): string {
    return readFileSync(tokensCssPath, 'utf8');
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ToggleButton', () => {
    it('renders aria-pressed="false" when unpressed', () => {
        render(<ToggleButton pressed={false}>Grid</ToggleButton>);

        expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('renders aria-pressed="true" when pressed', () => {
        render(<ToggleButton pressed>Grid</ToggleButton>);

        expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('calls onPressedChange with inverted value on click when unpressed', () => {
        const handler = vi.fn();
        render(
            <ToggleButton pressed={false} onPressedChange={handler}>
                Mute
            </ToggleButton>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

        expect(handler).toHaveBeenCalledWith(true);
    });

    it('calls onPressedChange with inverted value on click when pressed', () => {
        const handler = vi.fn();
        render(
            <ToggleButton pressed onPressedChange={handler}>
                Mute
            </ToggleButton>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

        expect(handler).toHaveBeenCalledWith(false);
    });

    it('calls onPressedChange on Enter key activation', async () => {
        const user = userEvent.setup();
        const handler = vi.fn();
        render(
            <ToggleButton pressed={false} onPressedChange={handler}>
                Inspect
            </ToggleButton>,
        );

        const button = screen.getByRole('button', { name: 'Inspect' });
        button.focus();
        await user.keyboard('{Enter}');

        expect(handler).toHaveBeenCalledWith(true);
    });

    it('calls onPressedChange on Space key activation', async () => {
        const user = userEvent.setup();
        const handler = vi.fn();
        render(
            <ToggleButton pressed={false} onPressedChange={handler}>
                Mode
            </ToggleButton>,
        );

        const button = screen.getByRole('button', { name: 'Mode' });
        button.focus();
        await user.keyboard(' ');

        expect(handler).toHaveBeenCalledWith(true);
    });

    it('does not call onPressedChange when disabled', () => {
        const handler = vi.fn();
        render(
            <ToggleButton disabled pressed={false} onPressedChange={handler}>
                Inspect
            </ToggleButton>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));

        expect(handler).not.toHaveBeenCalled();
    });

    it('is not clickable when disabled', () => {
        render(
            <ToggleButton disabled pressed={false}>
                Inspect
            </ToggleButton>,
        );

        const button = screen.getByRole('button', { name: 'Inspect' });
        expect(button).toBeDisabled();
    });

    it('adds data attribute for pressed state to support CSS selected visual', () => {
        render(<ToggleButton pressed>Snap</ToggleButton>);

        expect(screen.getByRole('button', { name: 'Snap' })).toHaveAttribute(
            'data-pressed',
            'true',
        );
    });

    it('adds data attribute for unpressed state to support CSS unselected visual', () => {
        render(<ToggleButton pressed={false}>Snap</ToggleButton>);

        expect(screen.getByRole('button', { name: 'Snap' })).toHaveAttribute(
            'data-pressed',
            'false',
        );
    });

    it('defaults to type="button"', () => {
        render(<ToggleButton pressed={false}>Grid</ToggleButton>);

        expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('type', 'button');
    });

    it('forwards additional className', () => {
        render(
            <ToggleButton className="extra-class" pressed={false}>
                Custom
            </ToggleButton>,
        );

        expect(screen.getByRole('button', { name: 'Custom' })).toHaveClass('extra-class');
    });

    it('CSS does not contain hardcoded colour, spacing, or radius values (invariant #86)', () => {
        const css = readCss();

        // No hex values
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        // No bare pixel values outside var() tokens
        const hardcoded = css.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
        expect(hardcoded).toBeNull();
    });

    it('has a :active press rule using the active transform token', () => {
        const css = readCss();

        expect(css).toContain(':active');
        expect(css).toContain('transform: var(--ch-button-transform-active);');
    });

    it('has a :focus-visible outline using design-token references', () => {
        const css = readCss();
        const tokensCss = readTokensCss();

        expect(tokensCss).toContain('--ch-focus-ring-width:');
        expect(tokensCss).toContain('--ch-focus-ring-color:');
        expect(css).toContain(':focus-visible');
        expect(css).toContain('outline:');
    });
});
