'use client';

import React, { useId } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Panel.module.css';

export type PanelVariant = 'surface' | 'raised';

export type PanelProps = Readonly<
    Omit<HTMLAttributes<HTMLElement>, 'style' | 'title'> & {
        readonly title?: React.ReactNode;
        readonly variant?: PanelVariant;
        readonly children: React.ReactNode;
        readonly style?: CSSProperties;
    }
>;

export function Panel({
    title,
    variant = 'surface',
    children,
    className,
    style,
    ...panelProps
}: PanelProps): React.ReactElement {
    const titleId = useId();
    const classNames = [styles['panel'], styles[variant], className].filter(Boolean).join(' ');

    return (
        <section
            {...panelProps}
            aria-labelledby={title ? titleId : undefined}
            className={classNames}
            data-ch-panel-variant={variant}
            role={title ? 'region' : undefined}
            style={style}
        >
            {title ? (
                <h2 className={styles['title']} id={titleId}>
                    {title}
                </h2>
            ) : null}
            <div className={styles['body']}>{children}</div>
        </section>
    );
}
