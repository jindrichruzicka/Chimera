'use client';

import React, { useId } from 'react';
import type { ChangeEvent, CSSProperties, SelectHTMLAttributes } from 'react';
import styles from './Select.module.css';

export type SelectOption = Readonly<{
    readonly disabled?: boolean;
    readonly label: string;
    readonly value: string;
}>;

export type SelectProps = Readonly<
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'onChange' | 'style' | 'value'> & {
        readonly error?: React.ReactNode;
        readonly helperText?: React.ReactNode;
        readonly invalid?: boolean;
        readonly label: React.ReactNode;
        readonly onValueChange?: (value: string) => void;
        readonly options: readonly SelectOption[];
        readonly style?: CSSProperties;
        readonly value: string;
    }
>;

export function Select({
    className,
    error,
    helperText,
    id,
    invalid = false,
    label,
    onValueChange,
    options,
    style,
    value,
    'aria-describedby': ariaDescribedBy,
    ...selectProps
}: SelectProps): React.ReactElement {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const helperId = `${selectId}-helper`;
    const errorId = `${selectId}-error`;
    const isInvalid = invalid || Boolean(error);
    const describedBy = [
        ariaDescribedBy,
        helperText ? helperId : undefined,
        error ? errorId : undefined,
    ]
        .filter(Boolean)
        .join(' ');
    const classNames = [styles['root'], className].filter(Boolean).join(' ');

    function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
        onValueChange?.(event.currentTarget.value);
    }

    return (
        <div className={classNames} style={style}>
            <label className={styles['label']} htmlFor={selectId}>
                {label}
            </label>
            <select
                {...selectProps}
                aria-describedby={describedBy || undefined}
                aria-invalid={isInvalid || undefined}
                className={styles['control']}
                data-invalid={String(isInvalid)}
                id={selectId}
                onChange={handleChange}
                value={value}
            >
                {options.map((option) => (
                    <option disabled={option.disabled} key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
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
