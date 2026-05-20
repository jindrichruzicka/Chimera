// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover';
import popoverCss from './Popover.module.css?raw';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Popover', () => {
    it('opens and closes from the trigger while preserving trigger relationships', () => {
        render(
            <Popover content="Compact controls" label="Unit actions">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Actions
                    </button>
                )}
            </Popover>,
        );

        const trigger = screen.getByRole('button', { name: 'Actions' });
        const contentId = trigger.getAttribute('aria-controls');

        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(contentId).toBeTruthy();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        fireEvent.click(trigger);

        const popover = screen.getByRole('dialog', { name: 'Unit actions' });
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(popover).toHaveAttribute('id', contentId);
        expect(popover).toHaveTextContent('Compact controls');

        fireEvent.click(trigger);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps generated IDs stable across rerenders', () => {
        const { rerender } = render(
            <Popover content="Inspect" label="Inspector">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Inspect
                    </button>
                )}
            </Popover>,
        );
        const firstId = screen
            .getByRole('button', { name: 'Inspect' })
            .getAttribute('aria-controls');

        rerender(
            <Popover content="Inspect updated" label="Inspector">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Inspect
                    </button>
                )}
            </Popover>,
        );

        expect(screen.getByRole('button', { name: 'Inspect' })).toHaveAttribute(
            'aria-controls',
            firstId,
        );
    });

    it('requests close from Escape and outside interaction', () => {
        const onOpenChange = vi.fn();

        render(
            <Popover defaultOpen content="Filters" label="Filters" onOpenChange={onOpenChange}>
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Filters
                    </button>
                )}
            </Popover>,
        );

        expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
        expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('moves focus into dialog content when opened and restores it when dismissed', () => {
        render(
            <Popover content="Compact controls" label="Unit actions">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Actions
                    </button>
                )}
            </Popover>,
        );

        const trigger = screen.getByRole('button', { name: 'Actions' });
        trigger.focus();
        fireEvent.click(trigger);

        expect(screen.getByRole('dialog', { name: 'Unit actions' })).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(trigger).toHaveFocus();
    });

    it('does not open from a disabled trigger', () => {
        const onOpenChange = vi.fn();

        render(
            <Popover disabled content="Unavailable" label="Unavailable" onOpenChange={onOpenChange}>
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Disabled actions
                    </button>
                )}
            </Popover>,
        );

        const trigger = screen.getByRole('button', { name: 'Disabled actions' });
        expect(trigger).toBeDisabled();

        fireEvent.click(trigger);

        expect(onOpenChange).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('stays closed when disabled even if defaultOpen is true', () => {
        render(
            <Popover disabled defaultOpen content="Unavailable" label="Unavailable">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Disabled actions
                    </button>
                )}
            </Popover>,
        );

        expect(screen.getByRole('button', { name: 'Disabled actions' })).toBeDisabled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('exposes placement and alignment variants through token-backed classes', () => {
        render(
            <Popover align="end" defaultOpen placement="top" content="Advanced" label="Advanced">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Advanced
                    </button>
                )}
            </Popover>,
        );

        const popover = screen.getByRole('dialog', { name: 'Advanced' });
        expect(popover).toHaveAttribute('data-ch-popover-placement', 'top');
        expect(popover).toHaveAttribute('data-ch-popover-align', 'end');
        expect(popover.className).toContain('top');
        expect(popover.className).toContain('alignEnd');
    });

    it('uses design tokens for placement, alignment, and visual styles', () => {
        const source = popoverCss;

        expect(source).toContain('background-color: var(--ch-color-surface-overlay);');
        expect(source).toContain('padding: var(--ch-space-md);');
        expect(source).toContain('z-index: var(--ch-z-tooltip);');
        expect(source).toContain('calc(100% + var(--ch-space-sm))');
        expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(source).not.toMatch(/\brgba?\s*\(/iu);
        expect(source).not.toMatch(/\bhsla?\s*\(/iu);
        expect(source.replace(/var\([^)]+\)/g, '')).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem)\b/);
    });
});
