// Renderer composition root for the tactics app — the renderer twin of
// `apps/tactics/electron/main.ts`. This is the SOLE renderer-side module that
// names a concrete game AND drives renderer registration: it builds the tactics
// `RendererGameContribution` and injects it into the game-agnostic renderer host
// through `registerRendererGame`. The host (`@chimera-engine/renderer`) ships no
// game-specific renderer code; a game's renderer surfaces enter only here.
//
// The renderer selects this module by build config, not by source import:
// `renderer/next.config.ts` aliases the synthetic `chimera-game-registration`
// specifier onto this file, mirroring how `package.json` `main` selects the
// Electron composition root. The registration runs as an import side effect, so a
// single `import 'chimera-game-registration'` from the renderer's client bootstrap
// populates the registry before any page reads it.

import { registerRendererGame, type RendererGameContribution } from '@chimera-engine/renderer/game';
import { TACTICS_GAME_ID } from '../simulation/constants.js';
import { loadTacticsRendererGame, loadTacticsRendererGameShell } from './loaders.js';

/**
 * The tactics reference game's renderer-side contribution. Exported for the
 * composition-root test; registered into the host below.
 */
export const tacticsRendererContribution: RendererGameContribution = {
    gameId: TACTICS_GAME_ID,
    loadGame: loadTacticsRendererGame,
    loadShell: loadTacticsRendererGameShell,
};

registerRendererGame(tacticsRendererContribution);
