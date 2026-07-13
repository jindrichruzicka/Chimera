'use client';

import React, { useState } from 'react';
import type { CSSProperties } from 'react';
import { MAX_SAVE_LABEL_LENGTH } from '@chimera-engine/simulation/bridge/api-types.js';
import { SAVE_GAME_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import { Button } from './Button';
import { Modal } from './Modal';
import { TextInput } from './TextInput';
import styles from './SaveGameButton.module.css';

export type SaveGameButtonProps = Readonly<{
    /**
     * Receives the trimmed save name when the player confirms; `''` when the
     * field is left blank (the caller decides default-name semantics).
     */
    readonly onSave: (label: string) => void;
    readonly disabled?: boolean;
    readonly style?: CSSProperties;
    /** Forwarded to the trigger button (e.g. `hud-save-btn` in the tactics HUD). */
    readonly 'data-testid'?: string;
}>;

/**
 * A compact Save trigger that prompts for a save name in a {@link Modal} before
 * invoking `onSave`. Pure callback component — no stores or IPC — so any game
 * HUD can drop it in and wire the `saveGame` capability it received.
 */
export function SaveGameButton({
    onSave,
    disabled = false,
    style,
    'data-testid': testId,
}: SaveGameButtonProps): React.ReactElement {
    const t = useTranslate();
    const [open, setOpen] = useState(false);
    const [label, setLabel] = useState('');

    function openDialog(): void {
        // Reset on open (not close) so a reopened dialog never shows a stale name.
        setLabel('');
        setOpen(true);
    }

    return (
        <>
            <Button
                disabled={disabled}
                onClick={openDialog}
                size="sm"
                variant="secondary"
                {...(style === undefined ? {} : { style })}
                {...(testId === undefined ? {} : { 'data-testid': testId })}
            >
                {t(SAVE_GAME_KEYS.save)}
            </Button>
            <Modal
                actions={[
                    { label: t(SAVE_GAME_KEYS.cancel), testId: 'save-name-cancel' },
                    {
                        label: t(SAVE_GAME_KEYS.save),
                        onClick: () => onSave(label.trim()),
                        testId: 'save-name-confirm',
                        variant: 'primary',
                    },
                ]}
                data-testid="save-name-dialog"
                onClose={() => setOpen(false)}
                open={open}
                title={t(SAVE_GAME_KEYS.dialogTitle)}
            >
                <div className={styles['body']}>
                    <TextInput
                        data-testid="save-name-input"
                        label={t(SAVE_GAME_KEYS.nameLabel)}
                        maxLength={MAX_SAVE_LABEL_LENGTH}
                        onValueChange={setLabel}
                        value={label}
                    />
                </div>
            </Modal>
        </>
    );
}
