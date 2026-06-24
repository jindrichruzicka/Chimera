// apps/tactics/renderer/loaders.ts
//
// The tactics renderer bundle loaders. Relocated out of
// `renderer/game/rendererGameRegistry.ts` in #784 so that `renderer/**` names no
// game: the renderer host became a runtime injection seam and the game's
// renderer contribution now lives in the consumer app. The `@chimera/tactics`
// dynamic imports are kept (so the heavy screen/shell/font modules stay
// code-split), rewritten as relative paths since this file is part of the
// `@chimera/tactics` library build.
//
// Font loading is intentionally NOT performed here: the renderer seam's
// `loadRendererGame`/`loadRendererGameShell` wrappers call `loadGameFonts` on the
// returned `shell.fonts`, keeping the renderer-internal `GameFontLoader` out of
// this game package (it is not a public `@chimera/renderer` barrel).

import type { LoadedRendererGame, LoadedRendererGameShell } from '@chimera/renderer/game';

export async function loadTacticsRendererGame(): Promise<LoadedRendererGame> {
    const [screenModule, assetManifestModule, shell] = await Promise.all([
        import('../screens/index.js'),
        import('../asset-manifest.js'),
        loadTacticsRendererGameShell(),
    ]);

    return {
        registry: screenModule.TacticsGameScreenRegistry,
        assetManifest: assetManifestModule.tacticsAssetManifest,
        inputActions: screenModule.TACTICS_INPUT_ACTIONS,
        shell,
    };
}

export async function loadTacticsRendererGameShell(): Promise<LoadedRendererGameShell> {
    await import('../styles/register-token-overrides.js');

    const [mainMenuModule, settingsPageModule, backgroundModule, lobbyScreenModule, fontsModule] =
        await Promise.all([
            import('../shell/main-menu.js'),
            import('../shell/settings-page.js'),
            import('../shell/TacticsShellBackground.js'),
            import('../shell/TacticsLobbyScreen.js'),
            import('../shell/fonts.js'),
        ]);

    return {
        mainMenu: mainMenuModule.tacticsMainMenuDefinition,
        menuCommands: mainMenuModule.tacticsMenuCommands,
        settings: settingsPageModule.tacticsSettingsPageDefinition,
        shellBackground: backgroundModule.TacticsShellBackground,
        LobbyScreen: lobbyScreenModule.TacticsLobbyScreen,
        fonts: fontsModule.tacticsFonts,
    };
}
