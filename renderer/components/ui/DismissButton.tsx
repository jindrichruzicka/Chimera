'use client';

import React from 'react';
import { IconButton, type IconButtonProps } from './IconButton';
import { Icon } from './icons';
import styles from './DismissButton.module.css';

/**
 * Shared dismiss affordance: the compact cross that deletes a row (saves,
 * replays) or closes an overlay (Drawer). Ghost at rest; hover and keyboard
 * focus swap the icon-button tokens to the danger set, which also raises the
 * visible border the ghost variant otherwise lacks (Invariant #91: tokens
 * only). One primitive so every cross in the shell hovers identically.
 *
 * Icon-only control, so the accessible name is required, not optional.
 */
export type DismissButtonProps = Readonly<
    Omit<IconButtonProps, 'children' | 'variant'> & {
        readonly 'aria-label': string;
    }
>;

export function DismissButton({
    className,
    ...buttonProps
}: DismissButtonProps): React.ReactElement {
    const classNames = [styles['dismiss'], className].filter(Boolean).join(' ');

    return (
        <IconButton
            {...buttonProps}
            className={classNames}
            data-ch-dismiss-button=""
            variant="ghost"
        >
            <Icon name="close" />
        </IconButton>
    );
}
