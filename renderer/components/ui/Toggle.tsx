'use client';

import React, { useId } from 'react';
import type { ChangeEvent, CSSProperties, InputHTMLAttributes } from 'react';
import styles from './Toggle.module.css';

export type ToggleProps = Readonly<
    Omit<
        InputHTMLAttributes<HTMLInputElement>,
        'aria-checked' | 'checked' | 'defaultChecked' | 'onChange' | 'role' | 'style' | 'type'
    > & {
        readonly checked: boolean;
        readonly helperText?: React.ReactNode;
        readonly label: React.ReactNode;
        readonly onCheckedChange?: (checked: boolean) => void;
        readonly style?: CSSProperties;
    }
>;

export function Toggle({
    checked,
    className,
    disabled,
    helperText,
    id,
    label,
    onCheckedChange,
    style,
    'aria-describedby': ariaDescribedBy,
    ...inputProps
}: ToggleProps): React.ReactElement {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const helperId = `${inputId}-helper`;
    const describedBy = [ariaDescribedBy, helperText ? helperId : undefined]
        .filter(Boolean)
        .join(' ');
    const classNames = [styles['root'], className].filter(Boolean).join(' ');

    function handleChange(event: ChangeEvent<HTMLInputElement>): void {
        onCheckedChange?.(event.currentTarget.checked);
    }

    return (
        <div
            className={classNames}
            data-checked={String(checked)}
            data-disabled={String(Boolean(disabled))}
            style={style}
        >
            <input
                {...inputProps}
                aria-describedby={describedBy || undefined}
                checked={checked}
                className={styles['input']}
                data-checked={String(checked)}
                disabled={disabled}
                id={inputId}
                onChange={handleChange}
                role="switch"
                type="checkbox"
            />
            <label className={styles['row']} htmlFor={inputId}>
                <span className={styles['label']}>{label}</span>
                <span aria-hidden="true" className={styles['track']}>
                    <span className={styles['thumb']} />
                </span>
            </label>
            {helperText ? (
                <span className={styles['helper']} id={helperId}>
                    {helperText}
                </span>
            ) : null}
        </div>
    );
}
