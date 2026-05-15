'use client';

import React from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Divider.module.css';

export type DividerOrientation = 'horizontal' | 'vertical';

export type DividerProps = Readonly<
    Omit<HTMLAttributes<HTMLHRElement>, 'style'> & {
        readonly orientation?: DividerOrientation;
        readonly style?: CSSProperties;
    }
>;

export function Divider({
    orientation = 'horizontal',
    className,
    style,
    ...dividerProps
}: DividerProps): React.ReactElement {
    const classNames = [styles['divider'], styles[orientation], className]
        .filter(Boolean)
        .join(' ');

    return (
        <hr
            {...dividerProps}
            aria-orientation={orientation}
            className={classNames}
            role="separator"
            style={style}
        />
    );
}
