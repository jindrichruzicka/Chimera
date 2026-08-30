// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { ACTION_GAME_ID } from '../simulation/constants.js';
import { actionAssetManifest } from '../asset-manifest.js';
import { actionManifest } from '../manifest.js';
import { actionShellAssetManifest, actionShellAudioRefs } from '../shell-asset-manifest.js';
import { ActionShellBackground } from '../shell/ActionShellBackground.js';
import {
    ACTION_SELECT_ROUTE,
    actionMainMenuDefinition,
    actionMenuCommands,
} from '../shell/main-menu.js';
import { actionBundleEn } from '../shell/translations/en.js';
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

    it('contributes the app’s own main menu and its command table', async () => {
        const shell = await loadActionRendererGameShell();

        expect(shell.mainMenu).toBe(actionMainMenuDefinition);
        expect(shell.menuCommands).toBe(actionMenuCommands);
    });

    it('contributes the live background and opts it into pointer input', async () => {
        // The flag is what makes the engine's own layers stand aside; without it
        // the scene renders and no click ever reaches it (§4.37.9).
        const shell = await loadActionRendererGameShell();

        expect(shell.shellBackground).toBe(ActionShellBackground);
        expect(shell.shellBackgroundInteractive).toBe(true);
    });

    it('declares NO background asset manifest, because the scene loads no file', async () => {
        // A session opened for a subtree with nothing to resolve builds a
        // manager for nothing. The primitives are r3f geometry with plain
        // materials.
        const shell = await loadActionRendererGameShell();

        expect(shell.shellBackgroundAssets).toBeUndefined();
    });

    it('opens the shell audio session over the shell inventory', async () => {
        const shell = await loadActionRendererGameShell();

        expect(shell.shellAudioAssets).toBe(actionShellAssetManifest);
    });

    it('declares the menu bed against a clip the shell inventory carries', async () => {
        // A bed whose ref is not in the manifest the session was built over is
        // inert: the load rejects and `play` swallows it, so the menu is silent
        // with nothing in the log.
        const shell = await loadActionRendererGameShell();

        expect(shell.shellMusicBed?.ref).toBe(actionShellAudioRefs.menuBed);
        expect(actionShellAssetManifest.entries.map((entry) => entry.ref)).toContain(
            shell.shellMusicBed?.ref,
        );
    });

    it('declares the select route the menu’s Start button navigates to', async () => {
        // The two halves — this declaration and the physical page — are also
        // cross-checked statically by `tools/shell-page-routes.test.ts`; what
        // this holds is that the MENU and the declaration name the same path.
        const shell = await loadActionRendererGameShell();

        expect(shell.shellRoutes).toEqual([ACTION_SELECT_ROUTE]);
    });

    it('contributes the English bundle under the locale the manifest declares', async () => {
        // A bundle keyed at a locale the manifest does not declare is one the
        // registry loader dev-warns about on every shell load.
        const shell = await loadActionRendererGameShell();

        expect(shell.translations?.bundles['en-US']).toBe(actionBundleEn);
        expect(shell.translations?.languages).toEqual(actionManifest.languages);
    });

    it('declares no settings page and no lobby screen', async () => {
        // Both would be a surface this app has not authored: the engine's own
        // four settings tabs are the ones it wants, and it opens no lobby.
        const shell = await loadActionRendererGameShell();

        expect(shell.settings).toBeUndefined();
        expect(shell.LobbyScreen).toBeUndefined();
    });
});
