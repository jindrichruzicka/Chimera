import type { GameManifest } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { ACTION_GAME_ID, ACTION_TICK_RATE_MS } from './simulation/constants.js';

/**
 * The action app's game manifest — the engine's second reference consumer and
 * its FIRST realtime one.
 *
 * `realtime: true` is the whole point: it is the single flag the host reads to
 * start a `RealtimeTicker`, which then dispatches `engine:tick` every
 * {@link ACTION_TICK_RATE_MS} milliseconds. The simulation's per-beat movement
 * pass rides that tick, so the manifest and the simulation must agree on the
 * interval — hence the imported constant rather than a second literal here.
 *
 * The rest of the surface is deliberately EMPTY. No `cursor`, no `logoScreen`,
 * no `icon`, no `languages`, no `spectators`: this task lands the app skeleton,
 * the simulation and the match screens, and every menu-facing declaration
 * belongs to the shell task that authors the menu it is for. An option declared
 * here before anything reads it is a claim the app cannot yet keep.
 */
export const actionManifest: GameManifest = {
    gameId: ACTION_GAME_ID,
    displayName: 'Action',
    realtime: true,
    tickRateMs: ACTION_TICK_RATE_MS,
};
