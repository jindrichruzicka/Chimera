// The tactics renderer bundle loaders. The renderer host names no game — it is a
// runtime injection seam — so the game's renderer contribution lives here in the
// consumer app. The dynamic imports keep the heavy screen/shell/font modules
// code-split, and use relative paths because this file is part of the
// `@chimera-engine/tactics` library build.
//
// Font loading is intentionally NOT performed here: the renderer seam's
// `loadRendererGame`/`loadRendererGameShell` wrappers call `loadGameFonts` on the
// returned `shell.fonts`, keeping the renderer-internal `GameFontLoader` out of
// this game package (it is not a public `@chimera-engine/renderer` barrel).

import type {
    GameTranslations,
    LoadedRendererGame,
    LoadedRendererGameShell,
} from '@chimera-engine/renderer/game';
import { resolveGameLanguages } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { tacticsManifest } from '../manifest.js';
import { tacticsBundleEn } from '../shell/translations/en.js';
import { tacticsBundleCs } from '../shell/translations/cs.js';

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

    const [
        mainMenuModule,
        settingsPageModule,
        backgroundModule,
        lobbyScreenModule,
        fontsModule,
        iconsModule,
    ] = await Promise.all([
        import('../shell/main-menu.js'),
        import('../shell/settings-page.js'),
        import('../shell/TacticsShellBackground.js'),
        import('../shell/TacticsLobbyScreen.js'),
        import('../shell/fonts.js'),
        import('../shell/icons.js'),
    ]);

    return {
        mainMenu: mainMenuModule.tacticsMainMenuDefinition,
        menuCommands: mainMenuModule.tacticsMenuCommands,
        settings: settingsPageModule.tacticsSettingsPageDefinition,
        shellBackground: backgroundModule.TacticsShellBackground,
        LobbyScreen: lobbyScreenModule.TacticsLobbyScreen,
        fonts: fontsModule.tacticsFonts,
        // The manifest's cursor declaration, forwarded verbatim: the renderer
        // seam (`loadRendererGameShell`) turns it into `--ch-cursor-*` token
        // overrides at registry init — this package never touches the DOM.
        cursor: tacticsManifest.cursor,
        translations: TACTICS_TRANSLATIONS,
        // Game-contributed UI glyphs, forwarded verbatim. The engine `<Icon>`
        // resolves `game.tactics.*` names against these via the app-wide
        // `<IconProvider>` — no DOM dispatch here (unlike cursor/fonts).
        icons: iconsModule.tacticsIcons,
    };
}

// The game's contributed i18n bundles. `languages` mirrors the manifest's
// declared list (the renderer seam cross-checks the bundle locales against it);
// the per-locale `bundles` re-key `game.tactics.*` (and override `engine.chat.*`)
// so the engine's `<I18nProvider>` layers them over its English default.
const TACTICS_TRANSLATIONS: GameTranslations = {
    languages: resolveGameLanguages(tacticsManifest) ?? [],
    bundles: {
        'en-US': tacticsBundleEn,
        'cs-CZ': tacticsBundleCs,
    },
};
