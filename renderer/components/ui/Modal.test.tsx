// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

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

    it('traps focus and closes on Escape', () => {
        const onClose = vi.fn();

        render(
            <Modal open title="Controls" onClose={onClose}>
                <button type="button">First</button>
                <button type="button">Second</button>
            </Modal>,
        );

        const closeButton = screen.getByRole('button', { name: /close/i });
        const second = screen.getByRole('button', { name: 'Second' });

        // Initial focus lands on the first focusable element (close button)
        expect(closeButton).toHaveFocus();

        // Tab from last element wraps back to the close button
        second.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(closeButton).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('renders a close button that calls onClose when clicked', () => {
        const onClose = vi.fn();

        render(
            <Modal open title="Settings" onClose={onClose}>
                Modal content
            </Modal>,
        );

        const closeButton = screen.getByRole('button', { name: /close/i });
        expect(closeButton).toHaveTextContent('X');

        fireEvent.click(closeButton);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('renders the close affordance as a danger icon button', () => {
        render(
            <Modal open title="Settings" onClose={vi.fn()}>
                Modal content
            </Modal>,
        );

        const closeButton = screen.getByRole('button', { name: /^close$/i });
        expect(closeButton).toHaveAttribute('data-ch-icon-button-variant', 'danger');
        expect(closeButton).toHaveTextContent('X');
        expect(closeButton).not.toHaveTextContent('Close');
    });

    it('renders overlay and close affordance while open', () => {
        render(
            <Modal open title="Settings" onClose={vi.fn()}>
                Modal content
            </Modal>,
        );

        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        expect(dialog.parentElement).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /close/i })).toHaveTextContent('X');
    });
});
