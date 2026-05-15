'use client';

import React from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './ScrollArea.module.css';

export type ScrollAreaProps = Readonly<
    Omit<HTMLAttributes<HTMLDivElement>, 'style'> & {
        readonly style?: CSSProperties;
    }
>;

export function ScrollArea({
    className,
    style,
    ...scrollProps
}: ScrollAreaProps): React.ReactElement {
    const classNames = [styles['scrollArea'], className].filter(Boolean).join(' ');

    return (
        <div
            {...scrollProps}
            className={classNames}
            data-ch-scroll-area="true"
            role={scrollProps['aria-label'] ? 'region' : undefined}
            style={style}
        />
    );
}
