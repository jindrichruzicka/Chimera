'use client';

import React from 'react';
import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import type { ButtonSize, ButtonVariant } from '../../theme/types';
import { useTheme } from '../../theme/useTheme';

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
    style,
    type = 'button',
    ...buttonProps
}: ButtonProps): React.ReactElement {
    const { current } = useTheme();
    const buttonStyle = current.palette.button;

    return (
        <button
            {...buttonProps}
            data-ch-button-variant={variant}
            data-ch-button-size={size}
            style={{
                ...buttonStyle.base,
                ...buttonStyle.variants[variant],
                ...buttonStyle.sizes[size],
                ...style,
            }}
            type={type}
        />
    );
}
