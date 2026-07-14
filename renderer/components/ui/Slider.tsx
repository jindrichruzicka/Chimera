'use client';

import React, { useId } from 'react';
import type { ChangeEvent, CSSProperties, InputHTMLAttributes } from 'react';
import styles from './Slider.module.css';

export type SliderProps = Readonly<
    Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'style' | 'type' | 'value'> & {
        readonly label: React.ReactNode;
        readonly value: number;
        readonly onChange?: (value: number) => void;
        /**
         * Visually hides the label while keeping it as the field's accessible
         * name. Use when surrounding context already makes the field's purpose
         * obvious (e.g. the replay scrubber on its own labelled panel).
         */
        readonly hideLabel?: boolean;
        readonly style?: CSSProperties;
    }
>;

export function Slider({
    label,
    value,
    onChange,
    hideLabel = false,
    className,
    style,
    id,
    ...sliderProps
}: SliderProps): React.ReactElement {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const classNames = [styles['root'], className].filter(Boolean).join(' ');
    const labelClassNames = [styles['label'], hideLabel ? styles['labelHidden'] : null]
        .filter(Boolean)
        .join(' ');

    function handleChange(event: ChangeEvent<HTMLInputElement>): void {
        onChange?.(event.currentTarget.valueAsNumber);
    }

    return (
        <label className={classNames} htmlFor={inputId} style={style}>
            <span className={labelClassNames}>{label}</span>
            <input
                {...sliderProps}
                className={styles['input']}
                id={inputId}
                onChange={handleChange}
                type="range"
                value={value}
            />
        </label>
    );
}
