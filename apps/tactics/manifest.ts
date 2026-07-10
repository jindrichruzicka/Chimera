import type { GameManifest } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { TACTICS_GAME_ID } from './simulation/constants.js';

/**
 * Tactics' game manifest. Tactics is the turn-based reference game: `realtime`
 * is `false` (no wall-clock heartbeat — an action-driven clock) and the window
 * title resolves to its display name "Tactics". No `icon` override ⇒ the
 * default Chimera icon (per-game icon override is M9 F67).
 *
 * The cursor textures under `assets/cursors/` are 32×32 solid-white
 * placeholders (F69): deliberate stand-ins meant to be overwritten with real
 * art later. Hotspots are omitted ⇒ top-left (0,0) until the art defines them.
 */
export const tacticsManifest: GameManifest = {
    gameId: TACTICS_GAME_ID,
    displayName: 'Tactics',
    realtime: false,
    cursor: {
        default: { image: 'cursors/default.png' },
        pointer: { image: 'cursors/pointer.png' },
        disabled: { image: 'cursors/disabled.png' },
    },
};
