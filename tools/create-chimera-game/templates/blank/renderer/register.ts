// Renderer composition root — the renderer twin of electron/main.ts and the SOLE
// renderer-side module that names this game. It builds the game's
// `RendererGameContribution` and injects it into the game-agnostic renderer host
// through `registerRendererGame`. The host (`@chimera-engine/renderer`) ships no
// game-specific renderer code; a game's renderer surfaces enter only here.
//
// The renderer selects this module by build config, not by source import:
// `renderer/next.config.ts` aliases the synthetic `chimera-game-registration`
// specifier onto this file. Registration runs as an import side effect, so a
// single `import 'chimera-game-registration'` from the renderer's client
// bootstrap populates the registry before any page reads it.

import { registerRendererGame, type RendererGameContribution } from '@chimera-engine/renderer/game';
import { __GAME_CONSTANT___GAME_ID } from '../simulation/constants.js';
import { load__GamePascal__RendererGame, load__GamePascal__RendererGameShell } from './loaders.js';

/**
 * __Game Title__'s renderer-side contribution. Exported for the composition-root
 * test; registered into the host below.
 */
export const __gameCamel__RendererContribution: RendererGameContribution = {
    gameId: __GAME_CONSTANT___GAME_ID,
    loadGame: load__GamePascal__RendererGame,
    loadShell: load__GamePascal__RendererGameShell,
};

registerRendererGame(__gameCamel__RendererContribution);
