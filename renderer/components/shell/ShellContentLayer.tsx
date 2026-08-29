'use client';

// renderer/components/shell/ShellContentLayer.tsx
//
// The app-level frame every route's content renders inside (§4.37.9): one
// positioned box at `--ch-z-raised`, which is what puts page content and the
// engine's overlay hosts above the shell background at `--ch-z-base`.
//
// It is a component rather than a bare `<div>` in `AppShell` for one reason:
// under a game's interactive-background opt-in it has to stand aside. A box
// with `pointer-events: auto` is a hit target over its whole area whether or
// not it paints anything, and this box grows to its content — which on a menu
// route is a full-viewport page — so a click aimed at the background lands here
// instead. Measured in the Electron renderer on `/main-menu`: this element
// spans the window, and with the menu alone made click-through
// `elementFromPoint` at an empty corner returns it, not the background.
//
// It stands aside by going `pointer-events: none` and restoring NOTHING, so
// the rule for everything it holds is: a surface that must stay usable states
// its own `pointer-events: auto`, and each states it where it lives — pinned
// there, beside the surface, rather than by a list kept in step here. A blanket
// `> *` restore would re-block the very click it just let through, and it could
// not know the markup of a game-owned page anyway.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract

import React, { type ReactNode } from 'react';

import { useShellBackgroundIsInteractive } from '../../shell/useShellBackgroundPayload';
import styles from './ShellContentLayer.module.css';

const layerStyle = {
    position: 'relative',
    zIndex: 'var(--ch-z-raised)',
} satisfies React.CSSProperties;

export interface ShellContentLayerProps {
    readonly children: ReactNode;
}

export function ShellContentLayer({ children }: ShellContentLayerProps): React.ReactElement {
    const isInteractive = useShellBackgroundIsInteractive();

    return (
        <div
            data-testid="shell-content-layer"
            {...(isInteractive ? { className: styles['click-through'] } : {})}
            style={layerStyle}
        >
            {children}
        </div>
    );
}
