'use client';

import React, { useEffect, useId, useRef } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { useEscapeLayer } from '../shell/EscapeStack';
import { IconButton } from './IconButton';
import styles from './Modal.module.css';

export type ModalProps = Readonly<
    Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'title'> & {
        readonly open: boolean;
        readonly title: React.ReactNode;
        readonly onClose: () => void;
        readonly children: React.ReactNode;
        readonly style?: CSSProperties;
    }
>;

const focusableSelector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
    open,
    title,
    onClose,
    children,
    className,
    style,
    ...dialogProps
}: ModalProps): React.ReactElement | null {
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement | null>(null);

    // Escape-to-close is routed through the shared overlay stack so a single
    // keydown is handled exactly once and an open overlay consumes Escape before
    // the window-level in-game menu toggle fires.
    useEscapeLayer(onClose, open);

    useEffect(() => {
        if (!open) return;

        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusable = getFocusableElements(dialog);
        const firstFocusable = focusable[0] ?? dialog;
        firstFocusable.focus();

        function handleKeyDown(event: KeyboardEvent): void {
            const currentDialog = dialogRef.current;
            if (!currentDialog) return;

            if (event.key !== 'Tab') return;

            const elements = getFocusableElements(currentDialog);
            if (elements.length === 0) {
                event.preventDefault();
                currentDialog.focus();
                return;
            }

            const first = elements[0];
            const last = elements[elements.length - 1];
            if (!first || !last) return;

            if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
                return;
            }

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    if (!open) return null;

    const classNames = [styles['overlay'], className].filter(Boolean).join(' ');

    return (
        <div className={classNames}>
            <div
                {...dialogProps}
                aria-labelledby={titleId}
                aria-modal="true"
                className={styles['dialog']}
                ref={dialogRef}
                role="dialog"
                style={style}
                tabIndex={-1}
            >
                <div className={styles['header']}>
                    <h2 className={styles['title']} id={titleId}>
                        {title}
                    </h2>
                    <IconButton
                        aria-label="Close"
                        className={styles['closeButton']}
                        onClick={onClose}
                        variant="danger"
                    >
                        <span aria-hidden="true">X</span>
                    </IconButton>
                </div>
                <div className={styles['body']}>{children}</div>
            </div>
        </div>
    );
}

function getFocusableElements(root: HTMLElement): readonly HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
    );
}
