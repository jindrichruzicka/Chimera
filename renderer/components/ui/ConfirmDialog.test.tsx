// @vitest-environment jsdom
// renderer/components/ui/ConfirmDialog.test.tsx
//
// Unit tests for the engine confirm dialog primitive and the useConfirmDialog()
// hook that queues a question on the shared confirm store.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract
//
// Invariants upheld:
//   #91 — no hardcoded colour/spacing literals (the dialog is a <Modal>)
//   #92 — the action row is the shared <Button> via <Modal>
//
// Tests written first (TDD — red confirmed: the module did not exist before
// this commit; vitest reported "Failed to load ./ConfirmDialog").

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { EscapeStackProvider } from '../shell/EscapeStack';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

afterEach(() => {
    cleanup();
});

function renderDialog(ui: React.ReactElement): void {
    render(
        <I18nProvider>
            <EscapeStackProvider>{ui}</EscapeStackProvider>
        </I18nProvider>,
    );
}

describe('ConfirmDialog', () => {
    it('renders nothing while closed', () => {
        renderDialog(
            <ConfirmDialog
                open={false}
                title="Overwrite?"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });

    it('renders the title, the body and both controls when open', () => {
        renderDialog(
            <ConfirmDialog
                open
                title="Overwrite?"
                body="Your autosave will be replaced."
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('Overwrite?')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-dialog-body')).toHaveTextContent(
            'Your autosave will be replaced.',
        );
        expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-dialog-cancel')).toBeInTheDocument();
    });

    it('omits the body paragraph when none is supplied', () => {
        renderDialog(
            <ConfirmDialog open title="Overwrite?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
        );

        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.queryByTestId('confirm-dialog-body')).toBeNull();
    });

    it('labels the controls from the engine common tokens by default', () => {
        renderDialog(
            <ConfirmDialog open title="Overwrite?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
        );

        expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Confirm');
        expect(screen.getByTestId('confirm-dialog-cancel')).toHaveTextContent('Cancel');
    });

    it('uses the supplied labels over the engine defaults', () => {
        renderDialog(
            <ConfirmDialog
                open
                title="Overwrite?"
                confirmLabel="Overwrite"
                cancelLabel="Keep it"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Overwrite');
        expect(screen.getByTestId('confirm-dialog-cancel')).toHaveTextContent('Keep it');
    });

    it('calls onConfirm — and never onCancel — when the accepting control is pressed', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        renderDialog(
            <ConfirmDialog open title="Overwrite?" onConfirm={onConfirm} onCancel={onCancel} />,
        );

        fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('calls onCancel — and never onConfirm — when the dismissing control is pressed', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        renderDialog(
            <ConfirmDialog open title="Overwrite?" onConfirm={onConfirm} onCancel={onCancel} />,
        );

        fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('leaves closing to the owner — the dialog is still mounted after an answer', () => {
        const onConfirm = vi.fn();
        renderDialog(
            <ConfirmDialog open title="Overwrite?" onConfirm={onConfirm} onCancel={vi.fn()} />,
        );

        fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    });

    it('answers Escape as a cancel', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        renderDialog(
            <ConfirmDialog open title="Overwrite?" onConfirm={onConfirm} onCancel={onCancel} />,
        );

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

// ─── useConfirmDialog ─────────────────────────────────────────────────────────

function Asker({
    onAnswer,
}: {
    readonly onAnswer: (accepted: boolean) => void;
}): React.ReactElement {
    const confirm = useConfirmDialog();
    const [renders, setRenders] = React.useState(0);
    seenConfirmFns.push(confirm);

    return (
        <>
            <button
                type="button"
                data-testid="ask"
                onClick={() => {
                    void confirm({ title: 'Overwrite?' }).then(onAnswer);
                }}
            >
                ask
            </button>
            <button
                type="button"
                data-testid="rerender"
                onClick={() => {
                    setRenders(renders + 1);
                }}
            >
                rerender
            </button>
        </>
    );
}

let seenConfirmFns: ((options: { readonly title: string }) => Promise<boolean>)[] = [];

describe('useConfirmDialog', () => {
    afterEach(() => {
        seenConfirmFns = [];
    });

    it('queues the question on the shared store so the mounted host shows it', async () => {
        const onAnswer = vi.fn();
        render(
            <I18nProvider>
                <EscapeStackProvider>
                    <Asker onAnswer={onAnswer} />
                </EscapeStackProvider>
            </I18nProvider>,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('ask'));
        });

        const { useConfirmDialogStore, selectPendingConfirm } =
            await import('../../state/confirmDialogStore');
        const pending = selectPendingConfirm(useConfirmDialogStore.getState());
        expect(pending?.title).toBe('Overwrite?');

        // Settle so the singleton queue does not leak into the next test.
        await act(async () => {
            useConfirmDialogStore.getState().settle(pending?.id ?? '', false);
        });
        expect(onAnswer).toHaveBeenCalledWith(false);
    });

    it('returns the same function across re-renders', () => {
        render(
            <I18nProvider>
                <EscapeStackProvider>
                    <Asker onAnswer={vi.fn()} />
                </EscapeStackProvider>
            </I18nProvider>,
        );

        fireEvent.click(screen.getByTestId('rerender'));

        expect(seenConfirmFns.length).toBeGreaterThan(1);
        expect(new Set(seenConfirmFns).size).toBe(1);
    });
});

// ─── Control order and initial focus ─────────────────────────────────────────
//
// <Modal> focuses the FIRST focusable element in the dialog, so the order of the
// `actions` array decides both the rendered order and which control the player
// lands on. Every assertion above resolves by testid, which is order-blind —
// these two are what makes swapping the entries visible.

describe('ConfirmDialog control order', () => {
    it('renders Cancel before Confirm', () => {
        renderDialog(
            <ConfirmDialog open title="Overwrite?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
        );

        const dialog = screen.getByTestId('confirm-dialog');
        const controls = [...dialog.querySelectorAll('button')].map((button) =>
            button.getAttribute('data-testid'),
        );

        expect(controls).toEqual(['confirm-dialog-cancel', 'confirm-dialog-confirm']);
    });

    it('gives Cancel the initial focus — the safe answer to a question worth asking', () => {
        renderDialog(
            <ConfirmDialog open title="Overwrite?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
        );

        expect(document.activeElement).toBe(screen.getByTestId('confirm-dialog-cancel'));
    });
});
