'use client';

import React from 'react';
import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import type { ButtonVariant } from '../../theme/types';
import styles from './IconButton.module.css';

export type IconButtonProps = Readonly<
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
        readonly variant?: ButtonVariant;
        readonly style?: CSSProperties;
    }
>;

export function IconButton({
    className,
    style,
    type = 'button',
    variant = 'secondary',
    ...buttonProps
}: IconButtonProps): React.ReactElement {
    const classNames = [styles['icon-button'], styles[variant], className]
        .filter(Boolean)
        .join(' ');

    return (
        <button
            {...buttonProps}
            className={classNames}
            data-ch-icon-button-variant={variant}
            style={style}
            type={type}
        />
    );
}
