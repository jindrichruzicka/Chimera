'use client';

import React, { useId, useState } from 'react';
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

export function Tooltip({
    content,
    children,
    className,
    style,
    ...tooltipProps
}: TooltipProps): React.ReactElement {
    const tooltipId = useId();
    const [open, setOpen] = useState(false);
    const classNames = [styles['root'], className].filter(Boolean).join(' ');

    const triggerProps: TooltipTriggerProps = {
        'aria-describedby': tooltipId,
        onBlur: () => {
            setOpen(false);
        },
        onFocus: () => {
            setOpen(true);
        },
        onMouseEnter: () => {
            setOpen(true);
        },
        onMouseLeave: () => {
            setOpen(false);
        },
    };

    return (
        <span className={classNames} style={style}>
            {children(triggerProps)}
            <span
                {...tooltipProps}
                className={styles['content']}
                hidden={!open}
                id={tooltipId}
                role="tooltip"
            >
                {content}
            </span>
        </span>
    );
}
