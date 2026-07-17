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

// ── Game-result emblems ──────────────────────────────────────────────────────
// The heraldic "Marshal's Seal" family shown on the end-of-match banner and the
// post-game summary. One construction language binds all four: a single ~4.3-unit
// band, a strict 45° facet grammar, and vertical mirror symmetry about x=12 — so
// the outcome is read from the shape's DIRECTION (rank up / rank down / level /
// sealed) before its colour. Each is a fill-based glyph carrying no `fill`, so it
// inherits the emblem's per-outcome `currentColor` like every other game glyph.

// VICTORY — an ascendant chevron (planted full-span feet, apex up) crowned by a
// floating five-point mullet: the summit, honours won.
const resultVictoryIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: (
        <path d="M3 16.8 L12 7.6 L21 16.8 L17.6 16.8 L12 12 L6.4 16.8 Z M12 0.9 L12.85 3.13 L15.23 3.25 L13.38 4.75 L14 7.05 L12 5.75 L10 7.05 L10.62 4.75 L8.77 3.25 L11.15 3.13 Z" />
    ),
};

// DEFEAT — victory's exact vertical mirror, uncrowned: the same chevron inverted
// (apex down), the crowning mullet gone. Direction flip + absent crown read the
// loss on two independent channels.
const resultDefeatIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: <path d="M3 7.2 L12 16.4 L21 7.2 L17.6 7.2 L12 12 L6.4 7.2 Z" />,
};

// DRAW — the chevron flattened and doubled into a heraldic double-fess: two level
// bars, ends chamfered at 45° to rhyme with the chevron miters. A balanced "=",
// neither rising nor falling.
const resultDrawIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: (
        <path d="M5 7 L19 7 L21 9 L19 11 L5 11 L3 9 Z M5 13 L19 13 L21 15 L19 17 L5 17 L3 15 Z" />
    ),
};

// CONCLUDED — victory's up-chevron fused with defeat's down-chevron into one
// sealed lozenge ring: both outcomes resolved, no side named. The inner diamond is
// wound opposite to the outer so the default nonzero rule punches a clean hole.
const resultConcludedIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: <path d="M12 4.5 L19.5 12 L12 19.5 L4.5 12 Z M12 8.8 L8.8 12 L12 15.2 L15.2 12 Z" />,
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
    'game.tactics.result-victory': resultVictoryIcon,
    'game.tactics.result-defeat': resultDefeatIcon,
    'game.tactics.result-draw': resultDrawIcon,
    'game.tactics.result-concluded': resultConcludedIcon,
} as const satisfies GameIconSet;
