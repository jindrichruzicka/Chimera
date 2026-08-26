// @vitest-environment jsdom
// renderer/components/shell/ConfirmDialogHost.test.tsx
//
// Unit tests for the single engine confirm surface: one host, mounted once by
// AppShell, that renders the head of the confirm queue and settles it.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract
//
// Tests written first (TDD — red confirmed: the module did not exist before
// this commit; vitest reported "Failed to resolve import ./ConfirmDialogHost").

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { useConfirmDialogStore, selectPendingConfirm } from '../../state/confirmDialogStore';
import { Modal } from '../ui/Modal';
import { EscapeStackProvider } from './EscapeStack';
import { ConfirmDialogHost } from './ConfirmDialogHost';

afterEach(() => {
    // Drain anything a test left queued so the singleton does not leak forward.
    for (const entry of useConfirmDialogStore.getState().queue) {
        useConfirmDialogStore.getState().settle(entry.id, false);
    }
    cleanup();
});

function mountHost(extra?: React.ReactNode): void {
    render(
        <I18nProvider>
            <EscapeStackProvider>
                {extra}
                <ConfirmDialogHost />
            </EscapeStackProvider>
        </I18nProvider>,
    );
}

// Boxed so awaiting the helper never chains onto the question itself: returning
// the promise bare from an async function would unwrap it and hang until the
// player answers — which is what the test has not done yet.
async function ask(options: {
    readonly title: string;
    readonly body?: string;
}): Promise<{ readonly answer: Promise<boolean> }> {
    let answer!: Promise<boolean>;
    await act(async () => {
        answer = useConfirmDialogStore.getState().request(options);
    });
    return { answer };
}

describe('ConfirmDialogHost', () => {
    it('shows nothing while the queue is empty', () => {
        mountHost();

        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });

    it('shows the queued question verbatim — the caller already resolved its tokens', async () => {
        mountHost();

        await ask({ title: 'Overwrite your save?', body: 'This cannot be undone.' });

        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('Overwrite your save?')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-dialog-body')).toHaveTextContent(
            'This cannot be undone.',
        );
    });

    it('resolves the request true and closes when the player accepts', async () => {
        mountHost();
        const { answer } = await ask({ title: 'Overwrite?' });

        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        });

        await expect(answer).resolves.toBe(true);
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });

    it('resolves the request false and closes when the player declines', async () => {
        mountHost();
        const { answer } = await ask({ title: 'Overwrite?' });

        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
        });

        await expect(answer).resolves.toBe(false);
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });

    it('answers Escape as a decline', async () => {
        mountHost();
        const { answer } = await ask({ title: 'Overwrite?' });

        await act(async () => {
            fireEvent.keyDown(window, { key: 'Escape' });
        });

        await expect(answer).resolves.toBe(false);
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });

    it('shows exactly one question at a time and advances to the next once answered', async () => {
        mountHost();
        const { answer: first } = await ask({ title: 'First question' });
        const { answer: second } = await ask({ title: 'Second question' });

        expect(screen.getAllByTestId('confirm-dialog')).toHaveLength(1);
        expect(screen.getByText('First question')).toBeInTheDocument();
        expect(screen.queryByText('Second question')).toBeNull();

        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        });
        await expect(first).resolves.toBe(true);

        expect(screen.getByText('Second question')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
        });
        await expect(second).resolves.toBe(false);
    });

    it('releases its EscapeStack layer — the surface below owns the next Escape', async () => {
        const onBaseClose = vi.fn();
        mountHost(
            <Modal open title="Saves" onClose={onBaseClose} data-testid="base-modal">
                base
            </Modal>,
        );
        const { answer } = await ask({ title: 'Overwrite?' });

        // First Escape belongs to the confirm — the layer registered last.
        await act(async () => {
            fireEvent.keyDown(window, { key: 'Escape' });
        });
        await expect(answer).resolves.toBe(false);
        expect(onBaseClose).not.toHaveBeenCalled();

        // Second Escape must reach the surface below; a leaked layer would swallow it.
        await act(async () => {
            fireEvent.keyDown(window, { key: 'Escape' });
        });
        expect(onBaseClose).toHaveBeenCalledTimes(1);
    });

    it('leaves the queue empty after the last question is answered', async () => {
        mountHost();
        await ask({ title: 'Overwrite?' });

        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        });

        expect(selectPendingConfirm(useConfirmDialogStore.getState())).toBeNull();
    });
});
