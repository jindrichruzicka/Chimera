'use client';

import React, { useContext } from 'react';
import type { CSSProperties } from 'react';
import { IconContext } from './icon-context';
import { ICON_REGISTRY, type IconGlyph, type IconName } from './registry';
import styles from './Icon.module.css';

/**
 * Renders a named glyph as a tokenized, currentColor SVG. The glyph is resolved
 * game-first: a game-contributed set (supplied by the active {@link IconProvider})
 * is checked before the engine {@link ICON_REGISTRY}, so a game can render its own
 * icon by name and can re-skin a built-in by re-keying it. An unknown name (no
 * engine or game glyph) renders nothing and dev-warns rather than crashing.
 *
 * Decorative by default (`aria-hidden`, no role, `focusable="false"`) — the
 * correct mode inside a labelled control such as an IconButton, where the
 * accessible name lives on the button's `aria-label`. Pass `title` to promote the
 * glyph to a standalone labelled image (`role="img"` + `aria-label` + a `<title>`)
 * for an icon that carries meaning on its own.
 */
export type IconProps = Readonly<{
    /**
     * The glyph to render. Engine built-in names (see {@link IconName})
     * autocomplete and are typo-checked; a game-contributed name (any other
     * string) resolves against the active {@link IconProvider} set at runtime,
     * falling back to the engine registry.
     */
    readonly name: IconName | (string & {});
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
}: IconProps): React.ReactElement | null {
    const gameIcons = useContext(IconContext);
    // Game-first, engine-fallback: a game can render its own glyph by name or
    // re-skin a built-in by re-keying it, and engine names still resolve when no
    // game set is present. The annotation keeps the undefined branch reachable —
    // the widened `name` is cast to index the literal-keyed engine registry.
    const glyph: IconGlyph | undefined = gameIcons?.[name] ?? ICON_REGISTRY[name as IconName];

    if (glyph === undefined) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn(
                `[chimera] <Icon> unknown name '${name}': no engine or game glyph is registered; rendering nothing.`,
            );
        }
        return null;
    }

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
