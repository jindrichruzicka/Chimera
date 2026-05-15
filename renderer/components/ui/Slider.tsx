'use client';

import React, { useId } from 'react';
import type { ChangeEvent, CSSProperties, InputHTMLAttributes } from 'react';
import styles from './Slider.module.css';

export type SliderProps = Readonly<
    Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'style' | 'type' | 'value'> & {
        readonly label: React.ReactNode;
        readonly value: number;
        readonly onChange?: (value: number) => void;
        readonly style?: CSSProperties;
    }
>;

export function Slider({
    label,
    value,
    onChange,
    className,
    style,
    id,
    ...sliderProps
}: SliderProps): React.ReactElement {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const classNames = [styles['root'], className].filter(Boolean).join(' ');

    function handleChange(event: ChangeEvent<HTMLInputElement>): void {
        onChange?.(event.currentTarget.valueAsNumber);
    }

    return (
        <label className={classNames} htmlFor={inputId} style={style}>
            <span className={styles['label']}>{label}</span>
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
