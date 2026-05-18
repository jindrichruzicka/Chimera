import { describe, expect, it } from 'vitest';
import { loadRendererGame, UnknownRendererGameError } from './rendererGameRegistry';

describe('rendererGameRegistry', () => {
    it('loads the registered tactics renderer bundle', async () => {
        const game = await loadRendererGame('tactics');

        expect(game.registry.board).toBeDefined();
        expect(game.assetManifest?.gameId).toBe('tactics');
        expect(game.inputActions?.map((action) => action.id)).toContain('game:end-turn');
    });

    it('rejects unknown game ids', async () => {
        await expect(loadRendererGame('missing-game')).rejects.toThrow(UnknownRendererGameError);
    });
});
