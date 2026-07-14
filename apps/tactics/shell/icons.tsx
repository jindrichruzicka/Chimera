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

// Keys are namespaced `game.tactics.*` so a glyph never silently overrides an
// engine built-in (the game-first lookup in `<Icon>` would otherwise do so).
// `as const satisfies GameIconSet` keeps local typo-safety on the game's own keys.
export const tacticsIcons = {
    'game.tactics.banner': bannerIcon,
} as const satisfies GameIconSet;
