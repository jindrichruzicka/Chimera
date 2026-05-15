'use client';

import React from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Badge.module.css';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'error';

export type BadgeProps = Readonly<
    Omit<HTMLAttributes<HTMLSpanElement>, 'style'> & {
        readonly variant?: BadgeVariant;
        readonly style?: CSSProperties;
    }
>;

export function Badge({
    variant = 'neutral',
    className,
    style,
    ...badgeProps
}: BadgeProps): React.ReactElement {
    const classNames = [styles['badge'], styles[variant], className].filter(Boolean).join(' ');

    return (
        <span
            {...badgeProps}
            className={classNames}
            data-ch-badge-variant={variant}
            style={style}
        />
    );
}
