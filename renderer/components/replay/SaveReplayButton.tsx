'use client';

/**
 * Save affordance for the replay player (§4.28): a compact save icon that opens
 * a name-prompt {@link Modal} before persisting the just-finished match, mirroring
 * {@link import('../ui/SaveGameButton').SaveGameButton}. Pure callback component —
 * no stores or IPC — so the player page owns the save state and receives the
 * entered name through `onSave`.
 *
 * The trigger stays disabled while a save is in flight (`saving`) and once it has
 * landed (`saved`) so the same replay cannot be saved twice; the accessible name
 * doubles as the saved-state signal (a perspective replay raises no toast, so the
 * label switch is its only confirmation). All buttons come from the `<IconButton>`
 * / `<Button>` UI primitives (Invariant #92) and text resolves through
 * `useTranslate()` (Invariant #91).
 */

import React, { useState } from 'react';
import { MAX_SAVE_LABEL_LENGTH } from '@chimera-engine/simulation/bridge/api-types.js';
import { Icon, IconButton, Modal, TextInput } from '../ui';
import { REPLAYS_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import styles from './SaveReplayButton.module.css';

export interface SaveReplayButtonProps {
    /** Receives the trimmed replay name when the player confirms; `''` when blank. */
    readonly onSave: (name: string) => void;
    /** A save round-trip is in flight — the icon is disabled. */
    readonly saving: boolean;
    /** The replay has been saved — the icon stays disabled so it can't repeat. */
    readonly saved: boolean;
}

export function SaveReplayButton({
    onSave,
    saving,
    saved,
}: SaveReplayButtonProps): React.ReactElement {
    const t = useTranslate();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');

    function openDialog(): void {
        // Reset on open (not close) so a reopened dialog never shows a stale name.
        setName('');
        setOpen(true);
    }

    return (
        <>
            <IconButton
                className={styles['save']}
                variant="ghost"
                // The accessible name doubles as the saved-state signal: a
                // perspective replay raises no toast, so the label switch (and the
                // disabled state) is the only confirmation a save landed.
                aria-label={saved ? t(REPLAYS_KEYS.replaySavedLabel) : t(REPLAYS_KEYS.saveReplay)}
                data-testid="replay-save-btn"
                disabled={saving || saved}
                onClick={openDialog}
            >
                <Icon name="save" />
            </IconButton>
            <Modal
                actions={[
                    { label: t(REPLAYS_KEYS.saveCancel), testId: 'replay-save-name-cancel' },
                    {
                        label: t(REPLAYS_KEYS.saveConfirm),
                        onClick: () => onSave(name.trim()),
                        testId: 'replay-save-name-confirm',
                        variant: 'primary',
                    },
                ]}
                data-testid="replay-save-name-dialog"
                onClose={() => setOpen(false)}
                open={open}
                title={t(REPLAYS_KEYS.saveDialogTitle)}
            >
                <div className={styles['body']}>
                    <TextInput
                        data-testid="replay-save-name-input"
                        label={t(REPLAYS_KEYS.saveNameLabel)}
                        maxLength={MAX_SAVE_LABEL_LENGTH}
                        onValueChange={setName}
                        value={name}
                    />
                </div>
            </Modal>
        </>
    );
}
