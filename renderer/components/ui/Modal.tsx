'use client';

import React, { useEffect, useId, useRef } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import type { ButtonVariant } from '../../theme/types';
import { useEscapeLayer } from '../shell/EscapeStack';
import { Button } from './Button';
import styles from './Modal.module.css';

/**
 * A single control button in a {@link Modal}'s centered action row. Clicking it
 * runs the optional `onClick` and then always dismisses the modal — a modal is a
 * one-shot decision surface, so every button closes it.
 */
export interface ModalAction {
    /** The button caption. */
    readonly label: React.ReactNode;
    /** Optional side effect run before the modal closes. Omit for a plain dismiss. */
    readonly onClick?: () => void;
    /** Button styling; defaults to `secondary`. Use `danger` for destructive actions. */
    readonly variant?: ButtonVariant;
    /** Optional `data-testid` forwarded to the rendered button. */
    readonly testId?: string;
}

export type ModalProps = Readonly<
    Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'title'> & {
        readonly open: boolean;
        readonly title: React.ReactNode;
        readonly onClose: () => void;
        readonly children: React.ReactNode;
        /**
         * The centered control buttons. When omitted, the modal renders a single
         * `Close` button that just dismisses it. When provided, exactly these
         * buttons render — supply your own cancel as a labelled action with no
         * `onClick` (it dismisses like any other).
         */
        readonly actions?: readonly ModalAction[];
        readonly style?: CSSProperties;
    }
>;

const DEFAULT_ACTIONS: readonly ModalAction[] = [{ label: 'Close', variant: 'primary' }];

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
    actions,
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
    const controls = actions && actions.length > 0 ? actions : DEFAULT_ACTIONS;

    // A modal is a one-shot decision surface: run the action, then always close.
    // A throwing action must never wedge the dialog open — and since closing
    // unmounts the modal, letting the throw propagate into React's dispatch would
    // only crash the surrounding tree, so contain it here (surfaced for debugging).
    const runAction = (action: ModalAction) => () => {
        try {
            action.onClick?.();
        } catch (error) {
            console.error('[Modal] action threw; closing anyway:', error);
        } finally {
            onClose();
        }
    };

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
                <h2 className={styles['title']} id={titleId}>
                    {title}
                </h2>
                <div className={styles['body']}>{children}</div>
                <div className={styles['actions']}>
                    {controls.map((action, index) => (
                        <Button
                            key={index}
                            size="sm"
                            variant={action.variant ?? 'secondary'}
                            {...(action.testId === undefined
                                ? {}
                                : { 'data-testid': action.testId })}
                            onClick={runAction(action)}
                        >
                            {action.label}
                        </Button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function getFocusableElements(root: HTMLElement): readonly HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
    );
}
