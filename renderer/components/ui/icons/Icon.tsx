'use client';

import React from 'react';
import type { CSSProperties } from 'react';
import { ICON_REGISTRY, type IconName } from './registry';
import styles from './Icon.module.css';

/**
 * Renders a named glyph from the icon registry as a tokenized, currentColor SVG.
 *
 * Decorative by default (`aria-hidden`, no role, `focusable="false"`) — the
 * correct mode inside a labelled control such as an IconButton, where the
 * accessible name lives on the button's `aria-label`. Pass `title` to promote the
 * glyph to a standalone labelled image (`role="img"` + `aria-label` + a `<title>`)
 * for an icon that carries meaning on its own.
 */
export type IconProps = Readonly<{
    readonly name: IconName;
    readonly className?: string;
    readonly style?: CSSProperties;
    readonly title?: string;
    readonly 'data-testid'?: string;
}>;

export function Icon({
    name,
    className,
    style,
    title,
    'data-testid': testId,
}: IconProps): React.ReactElement {
    const glyph = ICON_REGISTRY[name];
    const decorative = title === undefined;
    const classNames = [styles['icon'], className].filter(Boolean).join(' ');

    return (
        <svg
            aria-hidden={decorative ? true : undefined}
            aria-label={decorative ? undefined : title}
            className={classNames}
            data-ch-icon={name}
            focusable="false"
            role={decorative ? undefined : 'img'}
            viewBox={glyph.viewBox}
            {...(style === undefined ? {} : { style })}
            {...(testId === undefined ? {} : { 'data-testid': testId })}
        >
            {decorative ? null : <title>{title}</title>}
            {glyph.content}
        </svg>
    );
}
