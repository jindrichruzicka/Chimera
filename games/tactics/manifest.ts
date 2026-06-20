import type { GameManifest } from '@chimera/simulation/foundation/game-manifest-contract.js';

import { TACTICS_GAME_ID } from './constants.js';

/**
 * Tactics' game manifest. Tactics is the turn-based reference game: `realtime`
 * is `false` (no wall-clock heartbeat — an action-driven clock) and the window
 * title resolves to its display name "Tactics". No `icon` override ⇒ the
 * default Chimera icon (per-game icon override is M9 F67).
 */
export const tacticsManifest: GameManifest = {
    gameId: TACTICS_GAME_ID,
    displayName: 'Tactics',
    realtime: false,
};
