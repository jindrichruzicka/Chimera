'use client';

import React from 'react';
import type { CSSProperties, LabelHTMLAttributes } from 'react';
import styles from './Label.module.css';

export type LabelState = 'default' | 'required' | 'optional';

export type LabelProps = Readonly<
    Omit<LabelHTMLAttributes<HTMLLabelElement>, 'style'> & {
        readonly disabled?: boolean;
        readonly optional?: boolean;
        readonly required?: boolean;
        readonly style?: CSSProperties;
    }
>;

function getLabelState(required: boolean, optional: boolean): LabelState {
    if (required) {
        return 'required';
    }

    if (optional) {
        return 'optional';
    }

    return 'default';
}

export function Label({
    children,
    className,
    disabled = false,
    optional = false,
    required = false,
    style,
    ...labelProps
}: LabelProps): React.ReactElement {
    const state = getLabelState(required, optional);
    const classNames = [styles['label'], styles[state], className].filter(Boolean).join(' ');

    return (
        <label
            {...labelProps}
            aria-disabled={disabled || undefined}
            className={classNames}
            data-ch-label-state={state}
            data-disabled={String(disabled)}
            style={style}
        >
            {children}
        </label>
    );
}
