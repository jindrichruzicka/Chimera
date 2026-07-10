// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { tacticsManifest } from '../manifest.js';
import { loadTacticsRendererGame, loadTacticsRendererGameShell } from './loaders';

describe('tactics renderer loaders', () => {
    it('loadTacticsRendererGame exposes the screen registry, asset manifest, and input actions', async () => {
        const game = await loadTacticsRendererGame();

        expect(game.registry.board).toBeDefined();
        expect(game.assetManifest?.gameId).toBe('tactics');
        expect(game.inputActions?.map((action) => action.id)).toContain('game:end-turn');
    });

    it('loadTacticsRendererGame exposes the shell bundle (settings, lobby, main menu)', async () => {
        const game = await loadTacticsRendererGame();

        expect(game.shell?.LobbyScreen).toBeDefined();
        expect(game.shell?.shellBackground).toBeDefined();
        expect(game.shell?.mainMenu).toBeDefined();
        expect(Array.isArray(game.shell?.mainMenu?.buttons)).toBe(true);
        expect(game.shell?.settings?.tabs.map((tab) => tab.id)).toEqual([
            'audio',
            'display',
            'gameplay',
            'ai',
            'controls',
        ]);
    });

    it('loadTacticsRendererGameShell exposes the main menu buttons and an empty command registry', async () => {
        const shell = await loadTacticsRendererGameShell();

        expect(shell.mainMenu?.buttons.map((button) => button.label)).toEqual([
            'New Game',
            'Load Game',
            'Settings',
            'Replays',
            'Quit',
        ]);
        expect(shell.menuCommands).toEqual({});
        expect(shell.shellBackground).toBeDefined();
        expect(shell.LobbyScreen).toBeDefined();
    });

    it('loadTacticsRendererGameShell routes the Load Game button to /saves', async () => {
        const shell = await loadTacticsRendererGameShell();
        const loadGameBtn = shell.mainMenu?.buttons.find((b) => b.label === 'Load Game');

        expect(loadGameBtn).toBeDefined();
        expect(loadGameBtn?.action.type).toBe('navigate');
        if (loadGameBtn?.action.type === 'navigate') {
            expect(loadGameBtn.action.target).toBe('/saves');
        }
    });

    it('loadTacticsRendererGameShell forwards the manifest cursor declaration verbatim (#847)', async () => {
        const shell = await loadTacticsRendererGameShell();

        expect(shell.cursor).toBe(tacticsManifest.cursor);
    });

    it('loadTacticsRendererGameShell exposes the tactics font faces', async () => {
        const shell = await loadTacticsRendererGameShell();

        expect(shell.fonts?.map((font) => `${font.family}:${font.weight ?? '400'}`)).toEqual([
            'Cinzel:400',
            'Cinzel:700',
            'Cinzel:900',
            'Philosopher:400',
            'Philosopher:400',
            'Philosopher:700',
        ]);
    });
});
