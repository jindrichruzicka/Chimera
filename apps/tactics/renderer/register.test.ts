// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadRendererGame, loadRendererGameShell } from '@chimera-engine/renderer/game';
import { tacticsRendererContribution } from './register';

describe('tactics renderer composition root', () => {
    it('exposes a contribution for tactics', () => {
        expect(tacticsRendererContribution.gameId).toBe('tactics');
    });

    it('wires the registry so the tactics bundle resolves through the seam', async () => {
        const game = await loadRendererGame('tactics');

        expect(game.registry.board).toBeDefined();
        expect(game.assetManifest?.gameId).toBe('tactics');
    });

    it('wires the registry so the tactics shell resolves through the seam', async () => {
        const shell = await loadRendererGameShell('tactics');

        expect(shell.mainMenu?.buttons.length).toBeGreaterThan(0);
        expect(shell.LobbyScreen).toBeDefined();
    });
});
