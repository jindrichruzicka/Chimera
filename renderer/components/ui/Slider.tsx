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

/**
 * The percentage of the range that sits at or below `value`, feeding the
 * track's two-stop fill gradient. A zero (or inverted) span collapses to 0%
 * rather than dividing by zero.
 */
function fillPercent(value: number, min: number, max: number): number {
    const span = max - min;

    if (span <= 0) return 0;

    return Math.min(Math.max(((value - min) / span) * 100, 0), 100);
}

export function Slider({
    label,
    value,
    onChange,
    hideLabel = false,
    className,
    style,
    id,
    min = 0,
    max = 100,
    ...sliderProps
}: SliderProps): React.ReactElement {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const classNames = [styles['root'], className].filter(Boolean).join(' ');
    const labelClassNames = [styles['label'], hideLabel ? styles['labelHidden'] : null]
        .filter(Boolean)
        .join(' ');
    // Engine-private custom property: the CSS gradient that paints the filled
    // track portion cannot read the input's value, so it is bridged inline.
    const fillStyle = {
        '--_ch-slider-fill': `${fillPercent(value, Number(min), Number(max))}%`,
    } as CSSProperties;

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
                max={max}
                min={min}
                onChange={handleChange}
                style={fillStyle}
                type="range"
                value={value}
            />
        </label>
    );
}
