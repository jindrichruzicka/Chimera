// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EscapeStackProvider, useEscapeLayer } from '../shell/EscapeStack';
import { Modal } from './Modal';
import modalCss from './Modal.module.css?raw';

// Simulates a non-Modal overlay layer (key-capture, Drawer, …) registered above
// the Modal on the shared escape stack. Must mount after the Modal so its layer
// sits on top.
function StealTopLayer(): null {
    useEscapeLayer(() => undefined, true);
    return null;
}

// Modal routes Escape-to-close through the shared overlay stack, so every render
// must sit inside an EscapeStackProvider (useEscapeLayer throws otherwise).
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: EscapeStackProvider });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Modal', () => {
    it('renders an accessible dialog when open', () => {
        render(
            <Modal open title="Settings" onClose={vi.fn()}>
                Modal content
            </Modal>,
        );

        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByText('Modal content')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
        render(
            <Modal open={false} title="Hidden" onClose={vi.fn()}>
                Hidden content
            </Modal>,
        );

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders a single default Close button that dismisses when no actions are given', () => {
        const onClose = vi.fn();

        render(
            <Modal open title="Settings" onClose={onClose}>
                Modal content
            </Modal>,
        );

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(1);

        const close = screen.getByRole('button', { name: /close/i });
        expect(close).toBeInTheDocument();

        fireEvent.click(close);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not render a header close (X) affordance', () => {
        render(
            <Modal open title="Settings" onClose={vi.fn()}>
                Modal content
            </Modal>,
        );

        expect(screen.queryByText('X')).not.toBeInTheDocument();
    });

    it('renders the provided action buttons by label instead of the default', () => {
        render(
            <Modal
                open
                title="Delete replay?"
                onClose={vi.fn()}
                actions={[{ label: 'Cancel' }, { label: 'Delete', variant: 'danger' }]}
            >
                Body
            </Modal>,
        );

        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    });

    it('runs an action then always closes the modal', () => {
        const onClose = vi.fn();
        const onDelete = vi.fn();

        render(
            <Modal
                open
                title="Delete replay?"
                onClose={onClose}
                actions={[
                    { label: 'Cancel' },
                    { label: 'Delete', variant: 'danger', onClick: onDelete },
                ]}
            >
                Body
            </Modal>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onDelete).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        // The action runs before the modal closes.
        expect(onDelete.mock.invocationCallOrder[0]).toBeLessThan(
            onClose.mock.invocationCallOrder[0] ?? Infinity,
        );
    });

    it('closes when an action without an onClick is clicked', () => {
        const onClose = vi.fn();

        render(
            <Modal
                open
                title="Delete replay?"
                onClose={onClose}
                actions={[{ label: 'Cancel' }, { label: 'Delete', variant: 'danger' }]}
            >
                Body
            </Modal>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('still closes even if an action throws', () => {
        const onClose = vi.fn();
        const boom = vi.fn(() => {
            throw new Error('boom');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        render(
            <Modal open title="Danger" onClose={onClose} actions={[{ label: 'Go', onClick: boom }]}>
                Body
            </Modal>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Go' }));
        expect(boom).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledOnce();
    });

    it('applies the action variant and test id to the rendered button', () => {
        render(
            <Modal
                open
                title="Settings"
                onClose={vi.fn()}
                actions={[{ label: 'Delete', variant: 'danger', testId: 'confirm-delete' }]}
            >
                Body
            </Modal>,
        );

        const button = screen.getByTestId('confirm-delete');
        expect(button).toHaveAttribute('data-ch-button-variant', 'danger');
        expect(button).toHaveAttribute('data-ch-button-size', 'sm');
        expect(button).toHaveTextContent('Delete');
    });

    it('traps focus and closes on Escape', () => {
        const onClose = vi.fn();

        render(
            <Modal
                open
                title="Controls"
                onClose={onClose}
                actions={[{ label: 'First' }, { label: 'Second' }]}
            >
                Body content
            </Modal>,
        );

        const first = screen.getByRole('button', { name: 'First' });
        const second = screen.getByRole('button', { name: 'Second' });

        // Initial focus lands on the first focusable element (the first action)
        expect(first).toHaveFocus();

        // Tab from the last element wraps back to the first
        second.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(first).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('runs a non-dismissing action without closing the modal', () => {
        const onClose = vi.fn();
        const onReset = vi.fn();

        render(
            <Modal
                open
                title="Settings"
                onClose={onClose}
                actions={[
                    { label: 'Reset', variant: 'danger', dismiss: false, onClick: onReset },
                    { label: 'Close' },
                ]}
            >
                Body
            </Modal>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(onReset).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('does not close when a non-dismissing action throws', () => {
        const onClose = vi.fn();
        const boom = vi.fn(() => {
            throw new Error('boom');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        render(
            <Modal
                open
                title="Danger"
                onClose={onClose}
                actions={[{ label: 'Go', dismiss: false, onClick: boom }]}
            >
                Body
            </Modal>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Go' }));

        expect(boom).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('forwards disabled to the rendered action button and ignores clicks on it', () => {
        const onClose = vi.fn();
        const onHost = vi.fn();

        render(
            <Modal
                open
                title="Lobby"
                onClose={onClose}
                actions={[{ label: 'Hosting...', dismiss: false, disabled: true, onClick: onHost }]}
            >
                Body
            </Modal>,
        );

        const button = screen.getByRole('button', { name: 'Hosting...' });
        expect(button).toBeDisabled();

        fireEvent.click(button);
        expect(onHost).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('renders no action row at all when actions is an empty array', () => {
        render(
            <Modal
                open
                title="Lobby"
                onClose={vi.fn()}
                actions={[]}
                actionsTestId="lobby-action-bar"
            >
                Body
            </Modal>,
        );

        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryByTestId('lobby-action-bar')).not.toBeInTheDocument();
    });

    it('tags the action row with actionsTestId', () => {
        render(
            <Modal open title="Settings" onClose={vi.fn()} actionsTestId="settings-dialog-actions">
                Body
            </Modal>,
        );

        const row = screen.getByTestId('settings-dialog-actions');
        expect(row).toContainElement(screen.getByRole('button', { name: /close/i }));
    });

    it('exposes the size variant on the dialog, defaulting to md', () => {
        const { rerender } = render(
            <Modal open title="Sized" onClose={vi.fn()}>
                Body
            </Modal>,
        );

        expect(screen.getByRole('dialog')).toHaveAttribute('data-ch-modal-size', 'md');

        rerender(
            <Modal open size="xl" title="Sized" onClose={vi.fn()}>
                Body
            </Modal>,
        );

        expect(screen.getByRole('dialog')).toHaveAttribute('data-ch-modal-size', 'xl');
    });

    it('marks the dialog as fixed-height when fixedHeight is set', () => {
        render(
            <Modal open fixedHeight size="lg" title="Workspace" onClose={vi.fn()}>
                Body
            </Modal>,
        );

        expect(screen.getByRole('dialog')).toHaveAttribute('data-ch-modal-fixed-height', 'true');
    });

    it('forwards ariaDescribedBy to the rendered action button', () => {
        render(
            <Modal
                open
                title="Lobby"
                onClose={vi.fn()}
                actions={[
                    {
                        label: 'Leave Lobby',
                        variant: 'danger',
                        dismiss: false,
                        ariaDescribedBy: 'leave-warning',
                    },
                ]}
            >
                <span id="leave-warning">This will disconnect you</span>
            </Modal>,
        );

        expect(screen.getByRole('button', { name: 'Leave Lobby' })).toHaveAttribute(
            'aria-describedby',
            'leave-warning',
        );
    });

    it('suspends the Tab focus trap while another overlay layer sits above it', () => {
        render(
            <>
                <Modal
                    open
                    title="Below"
                    onClose={vi.fn()}
                    actions={[{ label: 'First' }, { label: 'Second' }]}
                >
                    Body
                </Modal>
                <StealTopLayer />
            </>,
        );

        const first = screen.getByRole('button', { name: 'First' });
        const second = screen.getByRole('button', { name: 'Second' });

        // With a foreign layer on top, Tab from the last element must NOT wrap —
        // the top surface owns the keyboard.
        second.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(first).not.toHaveFocus();
        expect(second).toHaveFocus();
    });
});

describe('Modal motion', () => {
    it('plays token-driven enter animations on the backdrop and dialog', () => {
        expect(modalCss).toMatch(
            /\.overlay\s*\{[^}]*animation-name:\s*var\(--ch-backdrop-anim-enter-name\);/s,
        );
        expect(modalCss).toMatch(
            /\.overlay\s*\{[^}]*animation-duration:\s*var\(--ch-backdrop-anim-enter-duration\);/s,
        );
        expect(modalCss).toMatch(
            /\.overlay\s*\{[^}]*animation-timing-function:\s*var\(--ch-backdrop-anim-enter-easing\);/s,
        );
        expect(modalCss).toMatch(/\.overlay\s*\{[^}]*animation-fill-mode:\s*both;/s);
        expect(modalCss).toMatch(
            /\.dialog\s*\{[^}]*animation-name:\s*var\(--ch-modal-anim-enter-name\);/s,
        );
        expect(modalCss).toMatch(
            /\.dialog\s*\{[^}]*animation-duration:\s*var\(--ch-modal-anim-enter-duration\);/s,
        );
        expect(modalCss).toMatch(
            /\.dialog\s*\{[^}]*animation-timing-function:\s*var\(--ch-modal-anim-enter-easing\);/s,
        );
        expect(modalCss).toMatch(/\.dialog\s*\{[^}]*animation-fill-mode:\s*both;/s);
    });

    it('switches to the exit animations and blocks pointer input while closing', () => {
        expect(modalCss).toMatch(
            /\.overlay\[data-ch-state='closing'\]\s*\{[^}]*animation-name:\s*var\(--ch-backdrop-anim-exit-name\);/s,
        );
        expect(modalCss).toMatch(
            /\.overlay\[data-ch-state='closing'\]\s*\{[^}]*pointer-events:\s*none;/s,
        );
        expect(modalCss).toMatch(
            /\.overlay\[data-ch-state='closing'\]\s+\.dialog\s*\{[^}]*animation-name:\s*var\(--ch-modal-anim-exit-name\);/s,
        );
    });

    it('paints the title through the token-driven gradient fill and outline', () => {
        // Gradient fill: background clipped to the glyphs with a transparent
        // fill colour, top→bottom stops driven by the title role tokens.
        expect(modalCss).toMatch(
            /\.title\s*\{[^}]*background-image:\s*linear-gradient\(\s*to bottom,\s*var\(--ch-title-fill-top\),\s*var\(--ch-title-fill-bottom\)\s*\);/s,
        );
        expect(modalCss).toMatch(/\.title\s*\{[^}]*background-clip:\s*text;/s);
        expect(modalCss).toMatch(/\.title\s*\{[^}]*-webkit-background-clip:\s*text;/s);
        expect(modalCss).toMatch(/\.title\s*\{[^}]*-webkit-text-fill-color:\s*transparent;/s);
        // Outline: engine default is 0px transparent, so the stroke only
        // appears when a game override sets the title outline tokens.
        expect(modalCss).toMatch(
            /\.title\s*\{[^}]*-webkit-text-stroke:\s*var\(--ch-title-outline-width\)\s*var\(--ch-title-outline-color\);/s,
        );
    });

    it('marks the overlay open and unmounts synchronously when motion is instant', () => {
        const { rerender } = render(
            <Modal open title="Settings" onClose={vi.fn()}>
                Modal content
            </Modal>,
        );

        expect(screen.getByRole('dialog').parentElement).toHaveAttribute('data-ch-state', 'open');

        // jsdom computes no animation — closing must collapse to an immediate
        // unmount inside the same act flush (the reduced-motion contract).
        rerender(
            <Modal open={false} title="Settings" onClose={vi.fn()}>
                Modal content
            </Modal>,
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
            <Modal open title="Settings" onClose={vi.fn()}>
                Modal content
            </Modal>,
        );
        const dialog = screen.getByRole('dialog');
        const overlay = dialog.parentElement;
        if (overlay === null) throw new Error('Expected the dialog to render inside the overlay');

        rerender(
            <Modal open={false} title="Settings" onClose={vi.fn()}>
                Modal content
            </Modal>,
        );

        expect(overlay).toHaveAttribute('data-ch-state', 'closing');
        expect(overlay).toHaveAttribute('inert');

        fireEvent.animationEnd(overlay);
        fireEvent.animationEnd(dialog);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
