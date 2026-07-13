// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EscapeStackProvider } from '../shell/EscapeStack';
import { I18nProvider } from '../../i18n/I18nProvider';
import { Drawer } from './Drawer';
import drawerCss from './Drawer.module.css?raw';

// Drawer resolves its default close label through useTranslate() and routes
// Escape through the shared overlay stack, so every render needs BOTH providers
// (each hook throws without its own).
function OverlayTestProviders({
    children,
}: {
    readonly children: React.ReactNode;
}): React.ReactElement {
    return (
        <I18nProvider>
            <EscapeStackProvider>{children}</EscapeStackProvider>
        </I18nProvider>
    );
}

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: OverlayTestProviders });

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

    it('renders the close affordance as a compact ghost icon button', () => {
        render(
            <Drawer open title="Inventory" onClose={vi.fn()}>
                Drawer content
            </Drawer>,
        );

        const closeButton = screen.getByRole('button', { name: /^close$/i });
        expect(closeButton).toHaveAttribute('data-ch-icon-button-variant', 'ghost');
        expect(closeButton).toHaveTextContent('×');
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

    it('scrims the backdrop with the same overlay token the modal uses', () => {
        // Drawer and Modal must share the --ch-color-overlay-backdrop token so
        // their overlays render identically; a game theme (e.g. Tactics) overrides
        // only that token, so the drawer must not fall back to surface-overlay.
        expect(drawerCss).toMatch(
            /\.overlay\s*\{[^}]*background-color: var\(--ch-color-overlay-backdrop\);/,
        );
        expect(drawerCss).not.toContain('var(--ch-color-surface-overlay)');
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

describe('Drawer motion', () => {
    it('plays token-driven enter animations on the backdrop and panel', () => {
        expect(drawerCss).toMatch(
            /\.overlay\s*\{[^}]*animation-name:\s*var\(--ch-backdrop-anim-enter-name\);/s,
        );
        expect(drawerCss).toMatch(
            /\.overlay\s*\{[^}]*animation-duration:\s*var\(--ch-backdrop-anim-enter-duration\);/s,
        );
        expect(drawerCss).toMatch(
            /\.overlay\s*\{[^}]*animation-timing-function:\s*var\(--ch-backdrop-anim-enter-easing\);/s,
        );
        expect(drawerCss).toMatch(/\.overlay\s*\{[^}]*animation-fill-mode:\s*both;/s);
        expect(drawerCss).toMatch(
            /\.drawer\s*\{[^}]*animation-name:\s*var\(--ch-drawer-anim-enter-name\);/s,
        );
        expect(drawerCss).toMatch(
            /\.drawer\s*\{[^}]*animation-duration:\s*var\(--ch-drawer-anim-enter-duration\);/s,
        );
        expect(drawerCss).toMatch(
            /\.drawer\s*\{[^}]*animation-timing-function:\s*var\(--ch-drawer-anim-enter-easing\);/s,
        );
        expect(drawerCss).toMatch(/\.drawer\s*\{[^}]*animation-fill-mode:\s*both;/s);
    });

    it('switches to the exit animations and blocks pointer input while closing', () => {
        expect(drawerCss).toMatch(
            /\.overlay\[data-ch-state='closing'\]\s*\{[^}]*animation-name:\s*var\(--ch-backdrop-anim-exit-name\);/s,
        );
        expect(drawerCss).toMatch(
            /\.overlay\[data-ch-state='closing'\]\s*\{[^}]*pointer-events:\s*none;/s,
        );
        expect(drawerCss).toMatch(
            /\.overlay\[data-ch-state='closing'\]\s+\.drawer\s*\{[^}]*animation-name:\s*var\(--ch-drawer-anim-exit-name\);/s,
        );
    });

    it('drives the slide direction per placement through private offset properties', () => {
        expect(drawerCss).toMatch(
            /\.drawer\.right\s*\{[^}]*--_ch-drawer-slide-x:\s*var\(--ch-drawer-slide-distance\);/s,
        );
        expect(drawerCss).toMatch(
            /\.drawer\.left\s*\{[^}]*--_ch-drawer-slide-x:\s*calc\(-1 \* var\(--ch-drawer-slide-distance\)\);/s,
        );
        expect(drawerCss).toMatch(
            /\.drawer\.top\s*\{[^}]*--_ch-drawer-slide-y:\s*calc\(-1 \* var\(--ch-drawer-slide-distance\)\);/s,
        );
        expect(drawerCss).toMatch(
            /\.drawer\.bottom\s*\{[^}]*--_ch-drawer-slide-y:\s*var\(--ch-drawer-slide-distance\);/s,
        );
    });

    it('marks the overlay open and unmounts synchronously when motion is instant', () => {
        const { rerender } = render(
            <Drawer open title="Inventory" onClose={vi.fn()}>
                Supplies
            </Drawer>,
        );

        expect(screen.getByRole('dialog').parentElement).toHaveAttribute('data-ch-state', 'open');

        // jsdom computes no animation — closing must collapse to an immediate
        // unmount inside the same act flush (the reduced-motion contract).
        rerender(
            <Drawer open={false} title="Inventory" onClose={vi.fn()}>
                Supplies
            </Drawer>,
        );

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('stays mounted inert in the closing state until its exit animations finish', () => {
        vi.spyOn(window, 'getComputedStyle').mockImplementation(
            () =>
                ({
                    animationDuration: '120ms',
                    animationDelay: '0s',
                }) as CSSStyleDeclaration,
        );
        const { rerender } = render(
            <Drawer open title="Inventory" onClose={vi.fn()}>
                Supplies
            </Drawer>,
        );
        const panel = screen.getByRole('dialog');
        const overlay = panel.parentElement;
        if (overlay === null) throw new Error('Expected the panel to render inside the overlay');

        rerender(
            <Drawer open={false} title="Inventory" onClose={vi.fn()}>
                Supplies
            </Drawer>,
        );

        expect(overlay).toHaveAttribute('data-ch-state', 'closing');
        expect(overlay).toHaveAttribute('inert');

        fireEvent.animationEnd(overlay);
        fireEvent.animationEnd(panel);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('paints the title through the token-driven gradient fill and outline', () => {
        expect(drawerCss).toMatch(
            /\.title\s*\{[^}]*background-image:\s*linear-gradient\(\s*to bottom,\s*var\(--ch-title-fill-top\),\s*var\(--ch-title-fill-bottom\)\s*\);/s,
        );
        expect(drawerCss).toMatch(/\.title\s*\{[^}]*background-clip:\s*text;/s);
        expect(drawerCss).toMatch(/\.title\s*\{[^}]*-webkit-text-fill-color:\s*transparent;/s);
        expect(drawerCss).toMatch(
            /\.title\s*\{[^}]*-webkit-text-stroke:\s*var\(--ch-title-outline-width\)\s*var\(--ch-title-outline-color\);/s,
        );
    });
});

describe('Drawer — close-label i18n default', () => {
    it('derives the default close label from the engine.common.close token (locale-following)', () => {
        baseRender(
            <I18nProvider
                locale="cs-CZ"
                languages={[
                    { code: 'en-US', label: 'English' },
                    { code: 'cs-CZ', label: 'Čeština' },
                ]}
                gameOverride={{ 'engine.common.close': 'Zavřít' }}
            >
                <EscapeStackProvider>
                    <Drawer open title="Inventář" onClose={vi.fn()}>
                        obsah
                    </Drawer>
                </EscapeStackProvider>
            </I18nProvider>,
        );

        expect(screen.getByRole('button', { name: 'Zavřít' })).toBeInTheDocument();
    });

    it('lets an explicit closeLabel prop win over the token default', () => {
        render(
            <Drawer open title="Inventory" onClose={vi.fn()} closeLabel="Dismiss">
                content
            </Drawer>,
        );

        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });
});
