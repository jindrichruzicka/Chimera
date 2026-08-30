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
 * `languages` names the ONE locale the shell's bundle is keyed at. A single
 * entry is behaviour-neutral by design — `resolveGameLanguages` answers
 * `undefined` below two, so the engine hides the language selector and never
 * switches locale — and declaring it is what stops the registry loader
 * dev-warning that the app's only translation bundle matches no declared
 * language.
 *
 * The rest of the surface is deliberately EMPTY. No `cursor`, no `logoScreen`,
 * no `icon`, no `spectators`: this app ships no cursor art, no boot sequence and
 * no spectator mode, and an option declared here before anything reads it is a
 * claim the app cannot keep.
 */
export const actionManifest: GameManifest = {
    gameId: ACTION_GAME_ID,
    displayName: 'Action',
    realtime: true,
    tickRateMs: ACTION_TICK_RATE_MS,
    languages: [{ code: 'en-US', label: 'English' }],
};
