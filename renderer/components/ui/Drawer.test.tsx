// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Drawer } from './Drawer';
import drawerCss from './Drawer.module.css?raw';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Drawer', () => {
    it('does not expose panel content while closed', () => {
        render(
            <Drawer open={false} title="Inventory" onClose={vi.fn()}>
                Hidden supplies
            </Drawer>,
        );

        expect(screen.queryByText('Hidden supplies')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('exposes an accessible dialog with a controlled placement while open', () => {
        render(
            <Drawer open placement="right" title="Inventory" onClose={vi.fn()}>
                Visible supplies
            </Drawer>,
        );

        const drawer = screen.getByRole('dialog', { name: 'Inventory' });
        expect(drawer).toHaveAttribute('aria-modal', 'true');
        expect(drawer).toHaveAttribute('data-ch-drawer-placement', 'right');
        expect(drawer.className).toContain('drawer');
        expect(drawer.className).toContain('right');
        expect(screen.getByText('Visible supplies')).toBeInTheDocument();
    });

    it('requests close from Escape, backdrop clicks, and the close button', () => {
        const onClose = vi.fn();

        render(
            <Drawer open title="Loadout" onClose={onClose}>
                Drawer content
            </Drawer>,
        );

        const drawer = screen.getByRole('dialog', { name: 'Loadout' });
        const backdrop = drawer.parentElement;
        expect(backdrop).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(backdrop!);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));

        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it('keeps pointer interaction inside the panel from closing the drawer', () => {
        const onClose = vi.fn();

        render(
            <Drawer open title="Loadout" onClose={onClose}>
                Drawer content
            </Drawer>,
        );

        fireEvent.click(screen.getByRole('dialog', { name: 'Loadout' }));

        expect(onClose).not.toHaveBeenCalled();
    });

    it('wraps keyboard focus within the open drawer', () => {
        render(
            <Drawer open title="Controls" onClose={vi.fn()}>
                <button type="button">First action</button>
                <button type="button">Last action</button>
            </Drawer>,
        );

        const closeButton = screen.getByRole('button', { name: /close/i });
        const lastAction = screen.getByRole('button', { name: 'Last action' });

        expect(closeButton).toHaveFocus();

        lastAction.focus();
        fireEvent.keyDown(document, { key: 'Tab' });

        expect(closeButton).toHaveFocus();
    });

    it('restores focus to the previously focused element after closing', () => {
        function TestDrawer(): React.ReactElement {
            const [open, setOpen] = React.useState(false);

            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Open drawer
                    </button>
                    <Drawer open={open} title="Controls" onClose={() => setOpen(false)}>
                        Drawer content
                    </Drawer>
                </>
            );
        }

        render(<TestDrawer />);

        const trigger = screen.getByRole('button', { name: 'Open drawer' });
        trigger.focus();
        fireEvent.click(trigger);

        expect(screen.getByRole('button', { name: /close/i })).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(trigger).toHaveFocus();
    });

    it('uses token-backed placement styles without hardcoded visual literals', () => {
        const source = drawerCss;

        expect(source).toContain('.left');
        expect(source).toContain('.right');
        expect(source).toContain('.top');
        expect(source).toContain('.bottom');
        expect(source).toContain('padding: var(--ch-space-lg);');
        expect(source).toContain('z-index: var(--ch-z-modal);');
        expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(source).not.toMatch(/\brgba?\s*\(/iu);
        expect(source).not.toMatch(/\bhsla?\s*\(/iu);
        expect(source.replace(/var\([^)]+\)/g, '')).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem)\b/);
    });
});
