// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EscapeStackProvider } from '../shell/EscapeStack';
import { Drawer } from './Drawer';
import drawerCss from './Drawer.module.css?raw';

// Drawer routes Escape-to-close through the shared overlay stack, so every render
// must sit inside an EscapeStackProvider (useEscapeLayer throws otherwise).
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: EscapeStackProvider });

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

    it('renders the close affordance as a danger icon button', () => {
        render(
            <Drawer open title="Inventory" onClose={vi.fn()}>
                Drawer content
            </Drawer>,
        );

        const closeButton = screen.getByRole('button', { name: /^close$/i });
        expect(closeButton).toHaveAttribute('data-ch-icon-button-variant', 'danger');
        expect(closeButton).toHaveTextContent('X');
        expect(closeButton).not.toHaveTextContent('Close');
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

    it('anchors panel content to the top and scrolls overflowing body content', () => {
        const source = drawerCss;

        expect(source).toMatch(/\.overlay\.left\s*\{[^}]*justify-content: flex-start;/);
        expect(source).toMatch(/\.overlay\.right\s*\{[^}]*justify-content: flex-end;/);
        expect(source).toMatch(/\.overlay\.top\s*\{[^}]*align-items: flex-start;/);
        expect(source).toMatch(/\.overlay\.bottom\s*\{[^}]*align-items: flex-end;/);
        expect(source).not.toMatch(/^\.(left|right|top|bottom)\s*\{/mu);
        expect(source).toMatch(/\.body\s*\{[^}]*min-block-size: var\(--ch-space-none\);/);
        expect(source).toMatch(/\.body\s*\{[^}]*overflow: auto;/);
    });

    it('delegates the leftover drawer height to the body so content can stretch to fill it', () => {
        expect(drawerCss).toMatch(/\.body\s*\{[^}]*flex: 1 1 auto;/);
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
