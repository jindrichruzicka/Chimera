'use client';

// renderer/components/ui/ConfirmDialog.tsx
//
// The engine's confirmation primitive: a two-choice <Modal> plus the
// useConfirmDialog() hook that queues a question on the shared confirm store.
//
// The dialog itself is presentational and answers nothing on its own — both
// controls declare `dismiss: false`, so the owner (ConfirmDialogHost) closes it
// by settling the request. That keeps a single answer per question: a
// self-dismissing control would fire onCancel through <Modal>'s onClose right
// after onConfirm.
//
// Architecture reference: §4.35 — GameShell UI Design System
//
// Invariants upheld:
//   #91 — no hardcoded colour/spacing literals; the surface is <Modal>
//   #92 — the action row uses the shared <Button> through <Modal>

import React from 'react';
import { COMMON_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import { useConfirmDialogStore, type ConfirmDialogOptions } from '../../state/confirmDialogStore';
import { Caption } from './Caption';
import { Modal } from './Modal';

export type ConfirmDialogProps = Readonly<{
    /** Whether the dialog is on screen. */
    readonly open: boolean;
    /** Dialog heading. */
    readonly title: React.ReactNode;
    /** Optional explanatory paragraph under the heading. */
    readonly body?: React.ReactNode;
    /** Label for the accepting control; `engine.common.confirm` when omitted. */
    readonly confirmLabel?: React.ReactNode;
    /** Label for the dismissing control; `engine.common.cancel` when omitted. */
    readonly cancelLabel?: React.ReactNode;
    /** Called when the player accepts. */
    readonly onConfirm: () => void;
    /** Called when the player declines — the dismissing control, or Escape. */
    readonly onCancel: () => void;
}>;

/**
 * A titled yes/no dialog. Cancel is listed first so it takes initial focus,
 * which is the safe answer for a question worth asking.
 */
export function ConfirmDialog({
    open,
    title,
    body,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
}: ConfirmDialogProps): React.ReactElement {
    const t = useTranslate();

    return (
        <Modal
            open={open}
            title={title}
            onClose={onCancel}
            data-testid="confirm-dialog"
            actions={[
                {
                    label: cancelLabel ?? t(COMMON_KEYS.cancel),
                    variant: 'secondary',
                    testId: 'confirm-dialog-cancel',
                    onClick: onCancel,
                    dismiss: false,
                },
                {
                    label: confirmLabel ?? t(COMMON_KEYS.confirm),
                    variant: 'primary',
                    testId: 'confirm-dialog-confirm',
                    onClick: onConfirm,
                    dismiss: false,
                },
            ]}
        >
            {body === undefined ? null : (
                <Caption data-testid="confirm-dialog-body" tone="muted">
                    {body}
                </Caption>
            )}
        </Modal>
    );
}

/**
 * Ask the player a yes/no question through the single engine confirm surface.
 *
 * ```typescript
 * const confirm = useConfirmDialog();
 * if (await confirm({ title: t(KEYS.overwriteTitle) })) { … }
 * ```
 *
 * Returns the store's own `request` method, which is stable for the lifetime of
 * the store — safe to list in a dependency array. Requires the
 * `<ConfirmDialogHost>` that `AppShell` mounts; without it the promise never
 * settles, because nothing is on screen to answer.
 */
export function useConfirmDialog(): (options: ConfirmDialogOptions) => Promise<boolean> {
    return useConfirmDialogStore((state) => state.request);
}
