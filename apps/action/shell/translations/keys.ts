// apps/action/shell/translations/keys.ts
//
// The action app's translation-token catalogue: the stable set of
// `TranslationKey` constants for every user-facing string its shell surfaces
// render. Grouped per-area maps for ergonomic component imports, plus a flat
// `ACTION_KEYS` aggregate for callers that iterate the whole set (the parity
// test, the bundle registration).
//
// Namespace convention: `game.action.<area>.<name>` — the game-owned `action`
// prefix under the `game` root (Invariant #11 reserves `engine.` for the
// engine).
//
// The MENU's tokens are deliberately here too, even though `main-menu.ts`
// cannot import this module: that file is boundary-restricted pure data (a
// plain `.ts` under `shell/`, which `chimera/no-game-renderer-internals` does
// not treat as a renderer surface), so it spells its labels as raw strings.
// `translations.test.ts` is what holds the two spellings together — a menu
// label that names no token here, or a token here that no bundle carries, reds
// there rather than rendering the raw key to the player.
//
// This module imports the runtime brand factory, so it is NOT one of the pure
// data modules; only `.tsx` components and the registration loader import it.

import { translationKey, type TranslationKey } from '@chimera-engine/renderer/i18n';

/** Main-menu button labels and the Start confirmation. */
export const MENU_KEYS = {
    continue: translationKey('game.action.menu.continue'),
    start: translationKey('game.action.menu.start'),
    settings: translationKey('game.action.menu.settings'),
    quit: translationKey('game.action.menu.quit'),
    startConfirmTitle: translationKey('game.action.menu.startConfirmTitle'),
    startConfirmBody: translationKey('game.action.menu.startConfirmBody'),
    startConfirmAccept: translationKey('game.action.menu.startConfirmAccept'),
} as const;

/** The `/select` page: its copy, its controls and their accessible names. */
export const SELECT_KEYS = {
    title: translationKey('game.action.select.title'),
    hint: translationKey('game.action.select.hint'),
    secondPlayer: translationKey('game.action.select.secondPlayer'),
    secondPlayerHint: translationKey('game.action.select.secondPlayerHint'),
    start: translationKey('game.action.select.start'),
    back: translationKey('game.action.select.back'),
    hostPick: translationKey('game.action.select.hostPick'),
    secondPick: translationKey('game.action.select.secondPick'),
    startFailed: translationKey('game.action.select.startFailed'),
} as const;

/**
 * Every token the app declares, keyed by its own string.
 *
 * Built from the groups above rather than re-typed, so a token added to a group
 * joins this set — and the parity test that reads it — by construction.
 */
export const ACTION_KEYS: Readonly<Record<string, TranslationKey>> = Object.fromEntries(
    [...Object.values(MENU_KEYS), ...Object.values(SELECT_KEYS)].map((key) => [key, key]),
);
