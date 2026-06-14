'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, PointerEvent, SelectHTMLAttributes } from 'react';
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
        /**
         * Visually hides the label while keeping it as the field's accessible
         * name. Use when surrounding context already makes the field's purpose
         * obvious (e.g. a per-row colour picker).
         */
        readonly hideLabel?: boolean;
        readonly invalid?: boolean;
        readonly label: React.ReactNode;
        readonly onValueChange?: (value: string) => void;
        readonly options: readonly SelectOption[];
        readonly style?: CSSProperties;
        readonly value: string;
    }
>;

type PopupAnchor = 'macos' | undefined;

/**
 * On macOS the native popup anchors to the <select> border-box, so the CSS
 * offsets that box inside the shell (see Select.module.css). Detected in an
 * effect because the statically exported markup has no navigator to consult.
 */
function usePopupAnchor(): PopupAnchor {
    const [popupAnchor, setPopupAnchor] = useState<PopupAnchor>(undefined);

    useEffect(() => {
        if (navigator.platform.startsWith('Mac')) {
            setPopupAnchor('macos');
        }
    }, []);

    return popupAnchor;
}

export function Select({
    className,
    error,
    helperText,
    hideLabel = false,
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
    const popupAnchor = usePopupAnchor();
    const selectRef = useRef<HTMLSelectElement>(null);
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

    // The macOS anchor offset leaves a popup-overhang-wide strip of the shell
    // uncovered by the <select>; hand clicks there back to the picker.
    function handleShellPointerDown(event: PointerEvent<HTMLSpanElement>): void {
        if (event.target !== event.currentTarget) {
            return;
        }
        const select = selectRef.current;
        if (!select || select.disabled) {
            return;
        }
        select.focus();
        try {
            select.showPicker();
        } catch {
            // Without user activation (or with the picker already open) the
            // browser refuses; keeping focus is the best remaining behaviour.
        }
    }

    return (
        <div className={classNames} data-popup-anchor={popupAnchor} style={style}>
            <label
                className={[styles['label'], hideLabel ? styles['labelHidden'] : null]
                    .filter(Boolean)
                    .join(' ')}
                htmlFor={selectId}
            >
                {label}
            </label>
            <span
                className={styles['controlShell']}
                onPointerDown={handleShellPointerDown}
                role="presentation"
            >
                <select
                    {...selectProps}
                    aria-describedby={describedBy || undefined}
                    aria-invalid={isInvalid || undefined}
                    className={styles['control']}
                    data-invalid={String(isInvalid)}
                    id={selectId}
                    onChange={handleChange}
                    ref={selectRef}
                    value={value}
                >
                    {options.map((option) => (
                        <option disabled={option.disabled} key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </span>
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
