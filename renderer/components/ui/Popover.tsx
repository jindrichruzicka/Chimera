'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, MouseEventHandler, ReactElement } from 'react';
import styles from './Popover.module.css';

export type PopoverPlacement = 'bottom' | 'left' | 'right' | 'top';
export type PopoverAlign = 'center' | 'end' | 'start';

export type PopoverTriggerProps = Readonly<{
    readonly 'aria-controls': string;
    readonly 'aria-expanded': boolean;
    readonly 'aria-haspopup': 'dialog';
    readonly disabled?: boolean | undefined;
    readonly onClick: MouseEventHandler<HTMLElement>;
}>;

export type PopoverProps = Readonly<
    Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'content' | 'style'> & {
        readonly label: string;
        readonly content: React.ReactNode;
        readonly children: (triggerProps: PopoverTriggerProps) => ReactElement;
        readonly align?: PopoverAlign;
        readonly defaultOpen?: boolean;
        readonly disabled?: boolean;
        readonly onOpenChange?: (open: boolean) => void;
        readonly open?: boolean;
        readonly placement?: PopoverPlacement;
        readonly style?: CSSProperties;
    }
>;

const alignmentClassByVariant = {
    center: styles['alignCenter'],
    end: styles['alignEnd'],
    start: styles['alignStart'],
} as const satisfies Readonly<Record<PopoverAlign, string | undefined>>;

const placementClassByVariant = {
    bottom: styles['bottom'],
    left: styles['left'],
    right: styles['right'],
    top: styles['top'],
} as const satisfies Readonly<Record<PopoverPlacement, string | undefined>>;

export function Popover({
    label,
    content,
    children,
    align = 'start',
    className,
    defaultOpen = false,
    disabled = false,
    onOpenChange,
    open,
    placement = 'bottom',
    style,
    ...popoverProps
}: PopoverProps): React.ReactElement {
    const popoverId = useId();
    const contentRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLSpanElement | null>(null);
    const restoreFocusElementRef = useRef<HTMLElement | null>(null);
    const [internalOpen, setInternalOpen] = useState(() => (disabled ? false : defaultOpen));
    const controlled = open !== undefined;
    const openState = controlled ? open : internalOpen;

    const requestOpenChange = useCallback(
        (nextOpen: boolean): void => {
            if (disabled && nextOpen) return;
            if (!controlled) setInternalOpen(nextOpen);
            onOpenChange?.(nextOpen);
        },
        [controlled, disabled, onOpenChange],
    );

    useEffect(() => {
        if (!openState) return;

        restoreFocusElementRef.current = getRestorableActiveElement();
        contentRef.current?.focus();

        function handleKeyDown(event: KeyboardEvent): void {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            requestOpenChange(false);
        }

        function handleMouseDown(event: MouseEvent): void {
            const root = rootRef.current;
            const target = event.target;
            if (!root || !(target instanceof Node) || root.contains(target)) return;
            requestOpenChange(false);
        }

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleMouseDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleMouseDown);
            restoreFocus(restoreFocusElementRef.current);
            restoreFocusElementRef.current = null;
        };
    }, [openState, requestOpenChange]);

    const triggerProps: PopoverTriggerProps = {
        'aria-controls': popoverId,
        'aria-expanded': openState,
        'aria-haspopup': 'dialog',
        disabled: disabled || undefined,
        onClick: (event) => {
            if (disabled) {
                event.preventDefault();
                return;
            }

            requestOpenChange(!openState);
        },
    };

    const contentClassNames = [
        styles['content'],
        placementClassByVariant[placement],
        alignmentClassByVariant[align],
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <span className={styles['root']} ref={rootRef}>
            {children(triggerProps)}
            <div
                {...popoverProps}
                aria-label={label}
                className={contentClassNames}
                data-ch-popover-align={align}
                data-ch-popover-placement={placement}
                hidden={!openState}
                id={popoverId}
                ref={contentRef}
                role="dialog"
                style={style}
                tabIndex={-1}
            >
                {content}
            </div>
        </span>
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
