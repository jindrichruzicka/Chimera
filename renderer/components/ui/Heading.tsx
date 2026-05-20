'use client';

import React from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Heading.module.css';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingSize = 'sm' | 'md' | 'lg' | 'xl';
export type HeadingTone = 'primary' | 'muted';

export type HeadingProps = Readonly<
    Omit<HTMLAttributes<HTMLHeadingElement>, 'style'> & {
        readonly level?: HeadingLevel;
        readonly size?: HeadingSize;
        readonly style?: CSSProperties;
        readonly tone?: HeadingTone;
    }
>;

const HEADING_TAGS = {
    1: 'h1',
    2: 'h2',
    3: 'h3',
    4: 'h4',
    5: 'h5',
    6: 'h6',
} as const satisfies Record<HeadingLevel, keyof React.JSX.IntrinsicElements>;

export function Heading({
    className,
    level = 2,
    size = 'lg',
    style,
    tone = 'primary',
    ...headingProps
}: HeadingProps): React.ReactElement {
    const Component = HEADING_TAGS[level];
    const classNames = [styles['heading'], styles[size], styles[tone], className]
        .filter(Boolean)
        .join(' ');

    return (
        <Component
            {...headingProps}
            className={classNames}
            data-ch-heading-level={String(level)}
            data-ch-heading-size={size}
            data-ch-heading-tone={tone}
            style={style}
        />
    );
}
