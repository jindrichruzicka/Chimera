'use client';

import React from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Caption.module.css';

export type CaptionTone = 'neutral' | 'muted' | 'error' | 'success';

export type CaptionProps = Readonly<
    Omit<HTMLAttributes<HTMLParagraphElement>, 'style'> & {
        readonly style?: CSSProperties;
        readonly tone?: CaptionTone;
    }
>;

export function Caption({
    className,
    style,
    tone = 'neutral',
    ...captionProps
}: CaptionProps): React.ReactElement {
    const classNames = [styles['caption'], styles[tone], className].filter(Boolean).join(' ');

    return <p {...captionProps} className={classNames} data-ch-caption-tone={tone} style={style} />;
}
