// __Game Title__'s manifest — the small, pure-data descriptor the host (window
// title + real-time ticker selection) and the renderer (shell display name) both
// read from one source of truth.

import type { GameManifest } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { __GAME_CONSTANT___GAME_ID } from './simulation/constants.js';

/**
 * `realtime: false` is the turn-based default — an action-driven clock with no
 * wall-clock heartbeat. For a clock-driven game set `realtime: true` and add an
 * optional `tickRateMs`.
 *
 * `icon` is a renderer-relative path under this game's own asset directory
 * (`assets/`, Invariant #97). The F67 resolver maps it to
 * `apps/__game_kebab__/assets/icons/icon.png` for the window/dock icon, and the
 * electron-builder config reuses the same PNG for the distributable bundle icon —
 * replace `assets/icons/icon.png` with your own art to rebrand both at once.
 */
export const __gameCamel__Manifest: GameManifest = {
    gameId: __GAME_CONSTANT___GAME_ID,
    displayName: '__Game Title__',
    realtime: false,
    icon: 'icons/icon.png',
};
