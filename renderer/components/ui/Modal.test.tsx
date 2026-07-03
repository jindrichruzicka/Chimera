// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EscapeStackProvider } from '../shell/EscapeStack';
import { Modal } from './Modal';

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
});
