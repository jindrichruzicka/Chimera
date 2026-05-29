'use client';

import React, { useEffect, useId, useRef } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { IconButton } from './IconButton';
import styles from './Drawer.module.css';

export type DrawerPlacement = 'bottom' | 'left' | 'right' | 'top';

export type DrawerProps = Readonly<
    Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'title'> & {
        readonly open: boolean;
        readonly title: React.ReactNode;
        readonly onClose: () => void;
        readonly children: React.ReactNode;
        readonly closeLabel?: string;
        readonly placement?: DrawerPlacement;
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

const placementClassByVariant = {
    bottom: styles['bottom'],
    left: styles['left'],
    right: styles['right'],
    top: styles['top'],
} as const satisfies Readonly<Record<DrawerPlacement, string | undefined>>;

export function Drawer({
    open,
    title,
    onClose,
    children,
    className,
    closeLabel = 'Close',
    placement = 'right',
    style,
    ...drawerProps
}: DrawerProps): React.ReactElement | null {
    const titleId = useId();
    const drawerRef = useRef<HTMLDivElement | null>(null);
    const onCloseRef = useRef(onClose);
    const restoreFocusElementRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open) return;

        const drawer = drawerRef.current;
        if (!drawer) return;

        restoreFocusElementRef.current = getRestorableActiveElement();

        const focusable = getFocusableElements(drawer);
        const firstFocusable = focusable[0] ?? drawer;
        firstFocusable.focus();

        function handleKeyDown(event: KeyboardEvent): void {
            const currentDrawer = drawerRef.current;
            if (!currentDrawer) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }

            if (event.key !== 'Tab') return;

            const elements = getFocusableElements(currentDrawer);
            if (elements.length === 0) {
                event.preventDefault();
                currentDrawer.focus();
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
            restoreFocus(restoreFocusElementRef.current);
            restoreFocusElementRef.current = null;
        };
    }, [open]);

    if (!open) return null;

    const placementClass = placementClassByVariant[placement];
    const overlayClassNames = [styles['overlay'], placementClass].filter(Boolean).join(' ');
    const drawerClassNames = [styles['drawer'], placementClass, className]
        .filter(Boolean)
        .join(' ');

    function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>): void {
        if (event.currentTarget !== event.target) return;
        onClose();
    }

    return (
        <div className={overlayClassNames} onClick={handleBackdropClick}>
            <div
                {...drawerProps}
                aria-labelledby={titleId}
                aria-modal="true"
                className={drawerClassNames}
                data-ch-drawer-placement={placement}
                ref={drawerRef}
                role="dialog"
                style={style}
                tabIndex={-1}
            >
                <div className={styles['header']}>
                    <h2 className={styles['title']} id={titleId}>
                        {title}
                    </h2>
                    <IconButton
                        aria-label={closeLabel}
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

function getRestorableActiveElement(): HTMLElement | null {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || activeElement === document.body) return null;
    return activeElement;
}

function restoreFocus(element: HTMLElement | null): void {
    if (!element?.isConnected) return;
    element.focus();
}
