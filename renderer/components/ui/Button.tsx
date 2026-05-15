'use client';

import React from 'react';
import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import type { ButtonSize, ButtonVariant } from '../../theme/types';
import styles from './Button.module.css';

export type ButtonProps = Readonly<
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
        readonly variant?: ButtonVariant;
        readonly size?: ButtonSize;
        readonly style?: CSSProperties;
    }
>;

export function Button({
    variant = 'primary',
    size = 'md',
    className,
    style,
    type = 'button',
    ...buttonProps
}: ButtonProps): React.ReactElement {
    const classNames = [styles['button'], styles[variant], styles[size], className]
        .filter(Boolean)
        .join(' ');

    return (
        <button
            {...buttonProps}
            className={classNames}
            data-ch-button-variant={variant}
            data-ch-button-size={size}
            style={style}
            type={type}
        />
    );
}
