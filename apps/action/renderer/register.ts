// Renderer composition root — the renderer twin of electron/main.ts, and where
// this game meets renderer registration. It builds the game's
// `RendererGameContribution` and injects it into the game-agnostic renderer host
// through `registerRendererGame`. The host (`@chimera-engine/renderer`) ships no
// game-specific renderer code; a game's renderer surfaces arrive at a root like
// this one.
//
// The renderer selects this module by build config, not by source import:
// `renderer/next.config.ts` aliases the synthetic `chimera-game-registration`
// specifier onto this file. Registration runs as an import side effect, so a
// single `import 'chimera-game-registration'` from the renderer's client
// bootstrap populates the registry before any page reads it.

import { registerRendererGame, type RendererGameContribution } from '@chimera-engine/renderer/game';

import { ACTION_GAME_ID } from '../simulation/constants.js';
import { loadActionRendererGame, loadActionRendererGameShell } from './loaders.js';

/**
 * The action app's renderer-side contribution. Exported for the
 * composition-root test; registered into the host below.
 */
export const actionRendererContribution: RendererGameContribution = {
    gameId: ACTION_GAME_ID,
    loadGame: loadActionRendererGame,
    loadShell: loadActionRendererGameShell,
};

registerRendererGame(actionRendererContribution);
