'use client';

// renderer/components/shell/ConfirmDialogHost.tsx
//
// The single engine confirm surface (the ToastHost pattern): mounted once by
// AppShell, it renders the head of the confirm queue and settles it with the
// player's answer. Declarative GameMainMenuButton.confirm and imperative
// useConfirmDialog() both queue here, and the host renders the head of that
// queue, so a question asked while one is open waits its turn and Escape
// addresses the one on screen.
//
// Strings arrive already resolved: a caller passes display text (the menu
// renderer resolves its declaration's tokens through t() before asking), so
// this host translates nothing but the dialog's own default control labels.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract

import React from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { selectPendingConfirm, useConfirmDialogStore } from '../../state/confirmDialogStore';

export function ConfirmDialogHost(): React.ReactElement | null {
    const pending = useConfirmDialogStore(selectPendingConfirm);
    const settle = useConfirmDialogStore((state) => state.settle);

    // Mounted only while a question is outstanding, which is how the saves
    // browser's own delete-confirm behaves. A settled question therefore leaves
    // at once rather than fading; when another is queued behind it the dialog
    // stays mounted and its content swaps.
    if (pending === null) return null;

    const answer = (accepted: boolean) => (): void => {
        settle(pending.id, accepted);
    };

    return (
        <ConfirmDialog
            open
            title={pending.title}
            {...(pending.body === undefined ? {} : { body: pending.body })}
            {...(pending.confirmLabel === undefined ? {} : { confirmLabel: pending.confirmLabel })}
            {...(pending.cancelLabel === undefined ? {} : { cancelLabel: pending.cancelLabel })}
            onConfirm={answer(true)}
            onCancel={answer(false)}
        />
    );
}
