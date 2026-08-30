// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { ACTION_GAME_ID } from '../simulation/constants.js';
import { actionAssetManifest } from '../asset-manifest.js';
import { ActionGameScreenRegistry } from '../screens/index.js';
import { ACTION_INPUT_ACTIONS } from './input-actions.js';
import { loadActionRendererGame, loadActionRendererGameShell } from './loaders';

describe('action renderer loaders', () => {
    it('exposes the screen registry the app authored', async () => {
        const game = await loadActionRendererGame();

        expect(game.registry).toBe(ActionGameScreenRegistry);
        expect(game.registry.playfield).toBeDefined();
    });

    it('forwards the asset manifest even while it is empty', async () => {
        // The whole reason the forward exists: `assetManifest` is optional, so
        // omitting it is silent until the first load rejects with
        // `UnknownAssetManifestEntryError` at runtime.
        const game = await loadActionRendererGame();

        expect(game.assetManifest).toBe(actionAssetManifest);
        expect(game.assetManifest?.gameId).toBe(ACTION_GAME_ID);
    });

    // The SHELL payload is the one a menu route loads, so it is the payload that
    // has to carry the actions for pre-match input and the Controls pane
    // (§4.26). Identity, not equality: ONE array reaches both payloads, so the
    // engine's app-boot registration and `GameShell`'s cannot disagree.
    it('carries the same input action table on both payloads', async () => {
        const [shell, game] = await Promise.all([
            loadActionRendererGameShell(),
            loadActionRendererGame(),
        ]);

        expect(shell.inputActions).toBe(ACTION_INPUT_ACTIONS);
        expect(game.inputActions).toBe(shell.inputActions);
    });

    it('exposes the shell bundle from the game payload', async () => {
        const game = await loadActionRendererGame();

        expect(game.shell?.inputActions).toBe(ACTION_INPUT_ACTIONS);
    });

    it('declares no menu surface yet — the engine defaults render', async () => {
        // Stated rather than left implicit: the shell task adds these, and until
        // it does, a value here would be a menu the app has not authored.
        const shell = await loadActionRendererGameShell();

        expect(shell.mainMenu).toBeUndefined();
        expect(shell.settings).toBeUndefined();
        expect(shell.shellBackground).toBeUndefined();
        expect(shell.shellBackgroundAssets).toBeUndefined();
        expect(shell.LobbyScreen).toBeUndefined();
    });
});
