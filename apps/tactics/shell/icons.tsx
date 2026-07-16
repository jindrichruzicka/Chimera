import React from 'react';

import type { GameIconSet, IconGlyph } from '@chimera-engine/renderer/components/ui';

// Tactics' contributed UI glyphs. These reach the engine `<Icon>` through the
// renderer registry shell seam (`LoadedRendererGameShell.icons`, forwarded from
// loaders.ts) and the app-wide `<IconProvider>`, so `<Icon name="game.tactics.*">`
// renders with the engine's `fill: currentColor` + `--ch-size-icon` styling —
// behaving exactly like a built-in, including inside an `<IconButton>`.
//
// Authored on the same fill-based contract as the engine glyphs: the path carries
// NO `fill`, so the shared `.icon { fill: currentColor }` rule colours it from the
// host control's colour token and its hover/focus states (Invariant #86/#113).

// A heraldic pennant on a 24-unit grid — the Tactics banner emblem.
const bannerIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: <path d="M6 2a1 1 0 0 0-1 1v18l7-4 7 4V3a1 1 0 0 0-1-1H6zm2 5h8v2H8V7z" />,
};

// A back-curving arrow — the Undo control. Filled arrowhead + sweep so it reads
// at HUD-icon size and inherits the host IconButton's colour via currentColor.
const undoIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: (
        <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
    ),
};

// The mirror of Undo — the Redo control (forward-curving arrow).
const redoIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: (
        <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z" />
    ),
};

// A skip-to-next glyph (triangle + bar) — End Turn / commit hands the turn on.
const endTurnIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />,
};

// A lightning bolt — the viewer's remaining stamina/energy readout.
const staminaIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: <path d="M7 2v11h3v9l7-12h-4l4-8z" />,
};

// Keys are namespaced `game.tactics.*` so a glyph never silently overrides an
// engine built-in (the game-first lookup in `<Icon>` would otherwise do so).
// `as const satisfies GameIconSet` keeps local typo-safety on the game's own keys.
export const tacticsIcons = {
    'game.tactics.banner': bannerIcon,
    'game.tactics.undo': undoIcon,
    'game.tactics.redo': redoIcon,
    'game.tactics.end-turn': endTurnIcon,
    'game.tactics.stamina': staminaIcon,
} as const satisfies GameIconSet;
