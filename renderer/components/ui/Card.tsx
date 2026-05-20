'use client';

import React from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Card.module.css';

export type CardElement = 'article' | 'div' | 'li' | 'section';
export type CardSurface = 'overlay' | 'raised' | 'surface';
export type CardElevation = 'lg' | 'md' | 'none' | 'sm';
export type CardPadding = 'lg' | 'md' | 'none' | 'sm';

export type CardProps = Readonly<
    Omit<HTMLAttributes<HTMLElement>, 'style'> & {
        readonly as?: CardElement;
        readonly elevation?: CardElevation;
        readonly padding?: CardPadding;
        readonly surface?: CardSurface;
        readonly style?: CSSProperties;
        readonly children: React.ReactNode;
    }
>;

const elevationClassByVariant = {
    lg: styles['elevationLg'],
    md: styles['elevationMd'],
    none: styles['elevationNone'],
    sm: styles['elevationSm'],
} as const satisfies Readonly<Record<CardElevation, string | undefined>>;

const paddingClassByVariant = {
    lg: styles['paddingLg'],
    md: styles['paddingMd'],
    none: styles['paddingNone'],
    sm: styles['paddingSm'],
} as const satisfies Readonly<Record<CardPadding, string | undefined>>;

const surfaceClassByVariant = {
    overlay: styles['overlay'],
    raised: styles['raised'],
    surface: styles['surface'],
} as const satisfies Readonly<Record<CardSurface, string | undefined>>;

export function Card({
    as = 'div',
    children,
    className,
    elevation = 'sm',
    padding = 'md',
    style,
    surface = 'surface',
    ...cardProps
}: CardProps): React.ReactElement {
    const Element = as;
    const classNames = [
        styles['card'],
        surfaceClassByVariant[surface],
        elevationClassByVariant[elevation],
        paddingClassByVariant[padding],
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <Element
            {...cardProps}
            className={classNames}
            data-ch-card-elevation={elevation}
            data-ch-card-padding={padding}
            data-ch-card-surface={surface}
            style={style}
        >
            {children}
        </Element>
    );
}
