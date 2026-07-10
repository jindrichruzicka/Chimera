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
 *
 * `cursor` (optional) re-textures the hardware mouse cursor. It maps the
 * engine's cursor roles — `default` | `pointer` | `disabled`, mirroring the
 * `--ch-cursor-*` token family — to images under this game's own asset
 * directory (`assets/`, Invariant #97), resolved by the renderer through the
 * game-asset protocol. Absent ⇒ the plain system cursor. `hotspot` is the
 * click point in image pixels from the texture's top-left; omit it for (0, 0).
 */
export const __gameCamel__Manifest: GameManifest = {
    gameId: __GAME_CONSTANT___GAME_ID,
    displayName: '__Game Title__',
    realtime: false,
    icon: 'icons/icon.png',
    // Uncomment (and add the matching PNG under assets/cursors/) to opt in:
    // cursor: {
    //     default: { image: 'cursors/default.png', hotspot: { x: 0, y: 0 } },
    // },
};
