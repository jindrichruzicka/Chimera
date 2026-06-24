// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
    getDefaultRendererGameId,
    loadRendererGame,
    loadRendererGameShell,
} from '@chimera/renderer/game';
import { tacticsRendererContribution } from './register';

describe('tactics renderer composition root', () => {
    it('registers tactics as the default renderer game on import', () => {
        expect(getDefaultRendererGameId()).toBe('tactics');
    });

    it('exposes a contribution flagged as the default', () => {
        expect(tacticsRendererContribution.gameId).toBe('tactics');
        expect(tacticsRendererContribution.isDefault).toBe(true);
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
