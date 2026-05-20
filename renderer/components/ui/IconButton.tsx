'use client';

import React from 'react';
import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import styles from './IconButton.module.css';

export type IconButtonProps = Readonly<
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
        readonly style?: CSSProperties;
    }
>;

export function IconButton({
    className,
    style,
    type = 'button',
    ...buttonProps
}: IconButtonProps): React.ReactElement {
    const classNames = [styles['icon-button'], className].filter(Boolean).join(' ');

    return <button {...buttonProps} className={classNames} style={style} type={type} />;
}
