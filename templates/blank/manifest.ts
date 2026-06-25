// __Game Title__'s manifest — the small, pure-data descriptor the host (window
// title + real-time ticker selection) and the renderer (shell display name) both
// read from one source of truth.

import type { GameManifest } from '@chimera/simulation/foundation/game-manifest-contract.js';

import { __GAME_CONSTANT___GAME_ID } from './constants.js';

/**
 * `realtime: false` is the turn-based default — an action-driven clock with no
 * wall-clock heartbeat. For a clock-driven game set `realtime: true` and add an
 * optional `tickRateMs`.
 */
export const __gameCamel__Manifest: GameManifest = {
    gameId: __GAME_CONSTANT___GAME_ID,
    displayName: '__Game Title__',
    realtime: false,
};
