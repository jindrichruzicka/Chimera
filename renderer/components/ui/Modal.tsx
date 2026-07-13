'use client';

import React, { useEffect, useId, useRef } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import type { ButtonVariant } from '../../theme/types';
import { COMMON_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import { useEscapeLayer } from '../shell/EscapeStack';
import { Button } from './Button';
import styles from './Modal.module.css';
import { useExitPresence } from './useExitPresence';

/**
 * A single control button in a {@link Modal}'s right-aligned action row.
 * Clicking it runs the optional `onClick` and then dismisses the modal unless
 * `dismiss: false` opts out (for in-place actions such as a settings Reset).
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
    /** Disables the rendered button (e.g. while a triggered request is pending). */
    readonly disabled?: boolean;
    /**
     * Forwarded as `aria-describedby` on the rendered button — point it at an
     * element in the modal body (e.g. a visually-hidden consequence warning).
     */
    readonly ariaDescribedBy?: string;
    /**
     * When `false`, clicking runs `onClick` but keeps the modal open — for
     * actions that operate in place (reset, host/join) rather than decide and
     * leave. Defaults to `true`.
     */
    readonly dismiss?: boolean;
}

/**
 * Dialog geometry presets. `md` is the decision-dialog default; `lg` fits a
 * browser/workspace surface (settings, saves); `xl` is the widest shell
 * surface (lobby).
 */
export type ModalSize = 'md' | 'lg' | 'xl';

export type ModalProps = Readonly<
    Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'title'> & {
        readonly open: boolean;
        readonly title: React.ReactNode;
        readonly onClose: () => void;
        readonly children: React.ReactNode;
        /**
         * The right-aligned control buttons. When omitted, the modal renders a
         * single `Close` button that just dismisses it. When provided, exactly
         * these buttons render — supply your own cancel as a labelled action
         * with no `onClick` (it dismisses like any other). An empty array
         * renders no action row at all, for surfaces whose controls live in the
         * body (e.g. an active lobby session).
         */
        readonly actions?: readonly ModalAction[];
        /** Dialog geometry preset; defaults to `md`. */
        readonly size?: ModalSize;
        /**
         * Pins the dialog to one static block-size regardless of content, so
         * body swaps (e.g. tab switches) never resize it. The body owns the
         * internal scrolling.
         */
        readonly fixedHeight?: boolean;
        /** Optional `data-testid` forwarded to the action row. */
        readonly actionsTestId?: string;
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
    actions,
    size = 'md',
    fixedHeight = false,
    actionsTestId,
    className,
    style,
    ...dialogProps
}: ModalProps): React.ReactElement | null {
    const t = useTranslate();
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);

    // Delayed unmount while the CSS exit animations play; collapses to a
    // synchronous unmount when motion is instant (reduced motion, jsdom).
    const { mounted, closing } = useExitPresence(open, [overlayRef, dialogRef]);

    // Escape-to-close is routed through the shared overlay stack so a single
    // keydown is handled exactly once and an open overlay consumes Escape before
    // the window-level in-game menu toggle fires.
    const escapeLayer = useEscapeLayer(onClose, open);

    useEffect(() => {
        if (!open) return;

        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusable = getFocusableElements(dialog);
        const firstFocusable = focusable[0] ?? dialog;
        firstFocusable.focus();

        function handleKeyDown(event: KeyboardEvent): void {
            // The trap is inert while another overlay layer (a nested Modal,
            // a key-capture layer, a Drawer) sits above this one — the top
            // surface owns the keyboard.
            if (!escapeLayer.isTopLayer()) return;

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
    }, [open, escapeLayer]);

    if (!mounted) return null;

    const classNames = [styles['overlay'], className].filter(Boolean).join(' ');
    const dialogClassNames = [
        styles['dialog'],
        size === 'md' ? undefined : styles[`size-${size}`],
        fixedHeight ? styles['fixed-height'] : undefined,
    ]
        .filter(Boolean)
        .join(' ');
    // `undefined` keeps the default lone Close; an explicit `[]` means the
    // surface's controls live in the body and no action row renders.
    // Default single-action row: label follows the active locale.
    const controls = actions ?? [{ label: t(COMMON_KEYS.close), variant: 'primary' as const }];

    // Run the action, then close unless it opted out (`dismiss: false`). A
    // throwing dismissing action must never wedge the dialog open — and since
    // closing unmounts the modal, letting the throw propagate into React's
    // dispatch would only crash the surrounding tree, so contain it here
    // (surfaced for debugging).
    const runAction = (action: ModalAction) => () => {
        try {
            action.onClick?.();
        } catch (error) {
            console.error('[Modal] action threw:', error);
        } finally {
            if (action.dismiss !== false) {
                onClose();
            }
        }
    };

    return (
        <div
            className={classNames}
            data-ch-state={closing ? 'closing' : 'open'}
            // A closing overlay is already past the point of interaction: inert
            // drops it from the a11y tree and releases focus while it fades.
            inert={closing || undefined}
            ref={overlayRef}
        >
            <div
                {...dialogProps}
                aria-labelledby={titleId}
                aria-modal="true"
                className={dialogClassNames}
                data-ch-modal-size={size}
                {...(fixedHeight ? { 'data-ch-modal-fixed-height': 'true' } : {})}
                ref={dialogRef}
                role="dialog"
                style={style}
                tabIndex={-1}
            >
                <h2 className={styles['title']} id={titleId}>
                    {title}
                </h2>
                <div className={styles['body']}>{children}</div>
                {controls.length > 0 ? (
                    <div
                        className={styles['actions']}
                        {...(actionsTestId === undefined ? {} : { 'data-testid': actionsTestId })}
                    >
                        {controls.map((action, index) => (
                            <Button
                                key={index}
                                size="sm"
                                variant={action.variant ?? 'secondary'}
                                {...(action.testId === undefined
                                    ? {}
                                    : { 'data-testid': action.testId })}
                                {...(action.disabled === undefined
                                    ? {}
                                    : { disabled: action.disabled })}
                                {...(action.ariaDescribedBy === undefined
                                    ? {}
                                    : { 'aria-describedby': action.ariaDescribedBy })}
                                onClick={runAction(action)}
                            >
                                {action.label}
                            </Button>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function getFocusableElements(root: HTMLElement): readonly HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
    );
}
