// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { tacticsMainMenuDefinition } from '../shell/main-menu.js';
import { tacticsManifest } from '../manifest.js';
import { loadTacticsRendererGame, loadTacticsRendererGameShell } from './loaders';

describe('tactics renderer loaders', () => {
    it('loadTacticsRendererGame exposes the screen registry, asset manifest, and input actions', async () => {
        const game = await loadTacticsRendererGame();

        expect(game.registry.playfield).toBeDefined();
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

    it('loadTacticsRendererGameShell exposes the menu definition itself and an empty command registry', async () => {
        const shell = await loadTacticsRendererGameShell();

        // Identity, not a second roll-call of the entries: what the loader owes
        // is the game's OWN definition, and the entries themselves are pinned in
        // `shell/main-menu.test.ts`. A list repeated here would be a copy of that
        // claim, falsified by every menu edit without measuring anything new.
        expect(shell.mainMenu).toBe(tacticsMainMenuDefinition);
        expect(shell.menuCommands).toEqual({});
        expect(shell.shellBackground).toBeDefined();
        expect(shell.LobbyScreen).toBeDefined();
    });

    it('loadTacticsRendererGameShell routes the Load Game button to /saves', async () => {
        const shell = await loadTacticsRendererGameShell();
        const loadGameBtn = shell.mainMenu?.buttons.find(
            (b) => b.label === 'game.tactics.menu.loadGame',
        );

        expect(loadGameBtn).toBeDefined();
        expect(loadGameBtn?.action.type).toBe('navigate');
        if (loadGameBtn?.action.type === 'navigate') {
            expect(loadGameBtn.action.target).toBe('/saves');
        }
    });

    it('loadTacticsRendererGameShell forwards the manifest cursor declaration verbatim', async () => {
        const shell = await loadTacticsRendererGameShell();

        expect(shell.cursor).toBe(tacticsManifest.cursor);
    });

    it('loadTacticsRendererGameShell contributes the game.tactics.* icon glyphs (#113)', async () => {
        const shell = await loadTacticsRendererGameShell();

        expect(Object.keys(shell.icons ?? {})).toContain('game.tactics.banner');
        const banner = shell.icons?.['game.tactics.banner'];
        expect(typeof banner?.viewBox).toBe('string');
    });

    it('loadTacticsRendererGameShell contributes the English and Czech translation bundles', async () => {
        const shell = await loadTacticsRendererGameShell();

        // Declared languages mirror the manifest (English first = default).
        expect(shell.translations?.languages).toEqual([
            { code: 'en-US', label: 'English' },
            { code: 'cs-CZ', label: 'Čeština' },
        ]);
        // Both locale bundles are present and carry the game's own tokens…
        expect(shell.translations?.bundles['en-US']?.['game.tactics.menu.newGame']).toBe(
            'New Game',
        );
        expect(shell.translations?.bundles['cs-CZ']?.['game.tactics.menu.newGame']).toBe(
            'Nová hra',
        );
        // …and the engine-token override (the required demo — Tactics relabels
        // the shared chat panel).
        expect(shell.translations?.bundles['en-US']?.['engine.chat.title']).toBe('Match chat');
        expect(shell.translations?.bundles['cs-CZ']?.['engine.chat.title']).toBe('Zápasový chat');
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
