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
import {
    resolveGameLanguages,
    resolveMatchHistorySupport,
} from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { tacticsManifest } from '../manifest.js';
import { TACTICS_INPUT_ACTIONS } from './input-actions.js';
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
        // The manifest's match-history capability, RESOLVED; see
        // `LoadedRendererGame.matchHistory` for why the renderer needs it
        // forwarded rather than read.
        matchHistory: resolveMatchHistorySupport(tacticsManifest),
        // Forwarded, not read: the renderer cannot reach a manifest. Read off
        // the manifest rather than written as `false`, so the two cannot drift
        // if this game ever declares otherwise.
        realtime: tacticsManifest.realtime,
        // Read back off the shell rather than re-stated: the same array reaches
        // both payloads, so the engine's app-boot registration and `GameShell`'s
        // re-registration cannot disagree about what an id means (§4.26). Spread
        // rather than assigned because `exactOptionalPropertyTypes` refuses an
        // explicit `undefined` for an optional field.
        ...(shell.inputActions === undefined ? {} : { inputActions: shell.inputActions }),
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
        // The rebindable action table (§4.26). Statically imported, unlike the
        // modules above: it is plain data with no DOM or React in it, so a
        // dynamic import would buy a chunk boundary for one small literal. Carrying it
        // on the SHELL payload is what lets the engine register it at app boot
        // — before a lobby, before a match — so a menu surface can subscribe
        // and Settings > Controls can list it.
        inputActions: TACTICS_INPUT_ACTIONS,
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
