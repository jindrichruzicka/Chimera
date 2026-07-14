'use client';

import React, { useId } from 'react';
import type { ChangeEvent, CSSProperties, InputHTMLAttributes } from 'react';
import styles from './TextInput.module.css';

export type TextInputProps = Readonly<
    Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'style' | 'type' | 'value'> & {
        readonly error?: React.ReactNode;
        readonly helperText?: React.ReactNode;
        /**
         * Visually hide the label while keeping it as the input's accessible
         * name (for surfaces where a placeholder or surrounding context already
         * names the field). Mirrors `Slider`/`Select` `hideLabel`.
         */
        readonly hideLabel?: boolean;
        readonly invalid?: boolean;
        readonly label: React.ReactNode;
        readonly onValueChange?: (value: string) => void;
        readonly style?: CSSProperties;
        readonly value: string;
    }
>;

export function TextInput({
    className,
    error,
    helperText,
    hideLabel = false,
    id,
    invalid = false,
    label,
    onValueChange,
    style,
    value,
    'aria-describedby': ariaDescribedBy,
    ...inputProps
}: TextInputProps): React.ReactElement {
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
    const labelClassNames = [styles['label'], hideLabel ? styles['labelHidden'] : null]
        .filter(Boolean)
        .join(' ');

    function handleChange(event: ChangeEvent<HTMLInputElement>): void {
        onValueChange?.(event.currentTarget.value);
    }

    return (
        <div className={classNames} style={style}>
            <label className={labelClassNames} htmlFor={inputId}>
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
                type="text"
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
