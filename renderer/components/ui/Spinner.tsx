'use client';

import React from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Spinner.module.css';

export type SpinnerProps = Readonly<
    Omit<HTMLAttributes<HTMLSpanElement>, 'style'> & {
        readonly label: string;
        readonly style?: CSSProperties;
    }
>;

export function Spinner({
    label,
    className,
    style,
    ...spinnerProps
}: SpinnerProps): React.ReactElement {
    const classNames = [styles['spinner'], className].filter(Boolean).join(' ');

    return (
        <span
            {...spinnerProps}
            aria-label={label}
            className={classNames}
            role="status"
            style={style}
        >
            <span className={styles['indicator']} />
        </span>
    );
}
