'use client';

import React, { useCallback } from 'react';
import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import styles from './ToggleButton.module.css';

export type ToggleButtonProps = Readonly<
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'onClick' | 'aria-pressed'> & {
        readonly pressed: boolean;
        readonly onPressedChange?: (pressed: boolean) => void;
        readonly style?: CSSProperties;
    }
>;

export function ToggleButton({
    pressed,
    onPressedChange,
    className,
    style,
    type = 'button',
    disabled,
    ...buttonProps
}: ToggleButtonProps): React.ReactElement {
    const classNames = [styles['toggle-button'], className].filter(Boolean).join(' ');

    const handleClick = useCallback((): void => {
        onPressedChange?.(!pressed);
    }, [pressed, onPressedChange]);

    return (
        <button
            {...buttonProps}
            aria-pressed={pressed}
            className={classNames}
            data-pressed={String(pressed)}
            disabled={disabled}
            onClick={handleClick}
            style={style}
            type={type}
        />
    );
}
