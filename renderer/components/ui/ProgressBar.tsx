'use client';

import React from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './ProgressBar.module.css';

export type ProgressBarProps = Readonly<
    Omit<HTMLAttributes<HTMLDivElement>, 'style'> & {
        readonly label: string;
        readonly value: number;
        readonly max?: number;
        readonly style?: CSSProperties;
    }
>;

export function ProgressBar({
    label,
    value,
    max = 100,
    className,
    style,
    ...progressProps
}: ProgressBarProps): React.ReactElement {
    const boundedMax = Math.max(0, max);
    const boundedValue = Math.min(Math.max(0, value), boundedMax);
    const fill = boundedMax === 0 ? 0 : (boundedValue / boundedMax) * 100;
    const classNames = [styles['root'], className].filter(Boolean).join(' ');

    return (
        <div
            {...progressProps}
            aria-label={label}
            aria-valuemax={boundedMax}
            aria-valuemin={0}
            aria-valuenow={boundedValue}
            className={classNames}
            role="progressbar"
            style={style}
        >
            <span className={styles['fill']} style={{ width: `${fill}%` }} />
        </div>
    );
}
