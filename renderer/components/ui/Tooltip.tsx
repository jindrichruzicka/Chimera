'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
    CSSProperties,
    FocusEventHandler,
    HTMLAttributes,
    MouseEventHandler,
    ReactElement,
} from 'react';
import styles from './Tooltip.module.css';

export type TooltipTriggerProps = Readonly<{
    readonly 'aria-describedby': string;
    readonly onBlur: FocusEventHandler<HTMLElement>;
    readonly onFocus: FocusEventHandler<HTMLElement>;
    readonly onMouseEnter: MouseEventHandler<HTMLElement>;
    readonly onMouseLeave: MouseEventHandler<HTMLElement>;
}>;

export type TooltipProps = Readonly<
    Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'content' | 'style'> & {
        readonly content: React.ReactNode;
        readonly children: (triggerProps: TooltipTriggerProps) => ReactElement;
        readonly style?: CSSProperties;
    }
>;

/** Viewport coordinates of the trigger's top-inline-start corner. */
type TriggerAnchor = Readonly<{ readonly top: number; readonly left: number }>;

export function Tooltip({
    content,
    children,
    className,
    style,
    ...tooltipProps
}: TooltipProps): React.ReactElement {
    const tooltipId = useId();
    const [open, setOpen] = useState(false);
    // Gates the portal to the client: server/first-client render keeps the
    // tooltip inline (so hydration matches), then it lifts to <body>.
    const [portalReady, setPortalReady] = useState(false);
    const [anchor, setAnchor] = useState<TriggerAnchor | null>(null);
    const rootRef = useRef<HTMLSpanElement | null>(null);
    const classNames = [styles['root'], className].filter(Boolean).join(' ');

    useEffect(() => {
        setPortalReady(true);
    }, []);

    const measure = (): void => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (rect) setAnchor({ left: rect.left, top: rect.top });
    };

    // While open, keep the fixed-position tooltip pinned to its trigger as the
    // page scrolls or resizes underneath it.
    useEffect(() => {
        if (!open) return undefined;
        measure();
        window.addEventListener('scroll', measure, true);
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('scroll', measure, true);
            window.removeEventListener('resize', measure);
        };
    }, [open]);

    const openTooltip = (): void => {
        // Measure synchronously so the first painted frame is already anchored.
        measure();
        setOpen(true);
    };
    const closeTooltip = (): void => {
        setOpen(false);
    };

    const triggerProps: TooltipTriggerProps = {
        'aria-describedby': tooltipId,
        onBlur: closeTooltip,
        onFocus: openTooltip,
        onMouseEnter: openTooltip,
        onMouseLeave: closeTooltip,
    };

    const tooltipNode = (
        <span
            {...tooltipProps}
            className={styles['content']}
            hidden={!open}
            id={tooltipId}
            role="tooltip"
            style={anchor ? { left: anchor.left, top: anchor.top } : undefined}
        >
            {content}
        </span>
    );

    return (
        <span className={classNames} ref={rootRef} style={style}>
            {children(triggerProps)}
            {portalReady ? createPortal(tooltipNode, document.body) : tooltipNode}
        </span>
    );
}
