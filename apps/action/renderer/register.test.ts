// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadRendererGame, loadRendererGameShell } from '@chimera-engine/renderer/game';

import { ACTION_GAME_ID } from '../simulation/constants.js';
import { ACTION_INPUT_ACTIONS } from './input-actions.js';
import { actionRendererContribution } from './register';

describe('action renderer composition root', () => {
    it('exposes a contribution for the action game id', () => {
        expect(actionRendererContribution.gameId).toBe(ACTION_GAME_ID);
    });

    it('wires the registry so the action bundle resolves through the seam', async () => {
        // Importing this module IS the registration (a side effect), so the
        // lookup below is what proves the side effect happened rather than
        // trusting the exported object.
        const game = await loadRendererGame(ACTION_GAME_ID);

        expect(game.registry.playfield).toBeDefined();
        expect(game.assetManifest?.gameId).toBe(ACTION_GAME_ID);
    });

    it('wires the registry so the action shell resolves through the seam', async () => {
        const shell = await loadRendererGameShell(ACTION_GAME_ID);

        expect(shell.inputActions).toBe(ACTION_INPUT_ACTIONS);
    });
});
