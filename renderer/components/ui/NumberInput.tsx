'use client';

import React, { useId } from 'react';
import type { ChangeEvent, CSSProperties, InputHTMLAttributes } from 'react';
import styles from './NumberInput.module.css';

export type NumberInputProps = Readonly<
    Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'style' | 'type' | 'value'> & {
        readonly error?: React.ReactNode;
        readonly helperText?: React.ReactNode;
        readonly invalid?: boolean;
        readonly label: React.ReactNode;
        readonly onValueChange?: (value: number) => void;
        readonly style?: CSSProperties;
        readonly value: number;
    }
>;

export function NumberInput({
    className,
    error,
    helperText,
    id,
    invalid = false,
    label,
    onValueChange,
    style,
    value,
    'aria-describedby': ariaDescribedBy,
    ...inputProps
}: NumberInputProps): React.ReactElement {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;
    const isInvalid = invalid || Boolean(error);
    const describedBy = [
        ariaDescribedBy,
        helperText ? helperId : undefined,
        error ? errorId : undefined,
    ]
        .filter(Boolean)
        .join(' ');
    const classNames = [styles['root'], className].filter(Boolean).join(' ');

    function handleChange(event: ChangeEvent<HTMLInputElement>): void {
        const nextValue = event.currentTarget.valueAsNumber;

        if (!Number.isNaN(nextValue)) {
            onValueChange?.(nextValue);
        }
    }

    return (
        <div className={classNames} style={style}>
            <label className={styles['label']} htmlFor={inputId}>
                {label}
            </label>
            <input
                {...inputProps}
                aria-describedby={describedBy || undefined}
                aria-invalid={isInvalid || undefined}
                className={styles['control']}
                data-invalid={String(isInvalid)}
                id={inputId}
                onChange={handleChange}
                type="number"
                value={value}
            />
            {helperText ? (
                <span className={styles['helper']} id={helperId}>
                    {helperText}
                </span>
            ) : null}
            {error ? (
                <span className={styles['error']} id={errorId}>
                    {error}
                </span>
            ) : null}
        </div>
    );
}
