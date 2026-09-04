// The action app's renderer bundle loaders. The renderer host names no game —
// it is a runtime injection seam — so the game's renderer contribution lives
// here in the consumer app. The dynamic imports keep the heavy screen and shell
// modules code-split, and use relative paths because this file is part of the
// `@chimera-engine/action` library build.
//
// Font loading is intentionally NOT performed here: the renderer seam's
// `loadRendererGame` / `loadRendererGameShell` wrappers call `loadGameFonts` on
// the returned `shell.fonts`, keeping the renderer-internal `GameFontLoader` out
// of this game package (it is not a public `@chimera-engine/renderer` barrel).

import type {
    GameTranslations,
    LoadedRendererGame,
    LoadedRendererGameShell,
} from '@chimera-engine/renderer/game';

import { resolveMatchHistorySupport } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import { actionManifest } from '../manifest.js';
import { actionShellAssetManifest, actionShellAudioRefs } from '../shell-asset-manifest.js';
import { actionBundleEn } from '../shell/translations/en.js';
import { ACTION_INPUT_ACTIONS } from './input-actions.js';

/**
 * The match payload.
 *
 * `assetManifest` is OPTIONAL on `LoadedRendererGame`, and forwarding it while
 * it is still EMPTY is the point: a game that omits it compiles, typechecks,
 * lints and passes `validate:assets` clean, then rejects every asset load at
 * runtime with `UnknownAssetManifestEntryError`, because the manager resolves
 * refs against the inventory it was handed and it was handed none. Wired from
 * the start, so the first entry added to `asset-manifest.ts` simply works.
 */
export async function loadActionRendererGame(): Promise<LoadedRendererGame> {
    const [screenModule, assetManifestModule, shell] = await Promise.all([
        import('../screens/index.js'),
        import('../asset-manifest.js'),
        loadActionRendererGameShell(),
    ]);

    return {
        registry: screenModule.ActionGameScreenRegistry,
        assetManifest: assetManifestModule.actionAssetManifest,
        // The manifest's match-history capability, RESOLVED; see
        // `LoadedRendererGame.matchHistory` for why the renderer needs it
        // forwarded rather than read.
        matchHistory: resolveMatchHistorySupport(actionManifest),
        // Read back off the SHELL rather than re-stated: the same array reaches
        // both payloads, so the engine's app-boot registration and `GameShell`'s
        // re-registration cannot disagree about what an id means (§4.26). Spread
        // rather than assigned because `exactOptionalPropertyTypes` refuses an
        // explicit `undefined` for an optional field.
        ...(shell.inputActions === undefined ? {} : { inputActions: shell.inputActions }),
        shell,
    };
}

/**
 * The shell payload — everything the menu, the live background and the game's
 * own `/select` page need.
 *
 * `shellBackgroundAssets` is deliberately ABSENT while `shellAudioAssets` is
 * present, and both point at the same file when a game needs both: the
 * background renders r3f geometry with plain materials and loads no declared
 * file, so a session opened for it would build a manager with nothing to
 * resolve. What the shell DOES load is audio, and that resolves through the
 * app-level `AudioManager`, which only `shellAudioAssets` binds a delegate for.
 */
export async function loadActionRendererGameShell(): Promise<LoadedRendererGameShell> {
    // Awaited, not fire-and-forget: the shell renders as soon as this resolves,
    // and tokens installed after first paint are a visible flash of the engine
    // defaults.
    await import('../styles/register-token-overrides.js');

    const [mainMenuModule, backgroundModule] = await Promise.all([
        import('../shell/main-menu.js'),
        import('../shell/ActionShellBackground.js'),
    ]);

    return {
        mainMenu: mainMenuModule.actionMainMenuDefinition,
        menuCommands: mainMenuModule.actionMenuCommands,
        shellBackground: backgroundModule.ActionShellBackground,
        // The opt-in that makes the scene CLICKABLE (§4.37.9): the host stops
        // refusing pointer events and stops hiding itself from assistive tech,
        // the engine's own layers stand aside, and this game's `/select` page
        // owns the pass-through on its own route.
        //
        // What the dropped `aria-hidden` exposes here is a canvas, and a click
        // target inside one has no DOM node to carry a name or a role. The
        // picker that does is `/select`: it names both seats' picks in text and
        // moves them on the declared movement actions, so every pick the scene
        // offers is reachable without the pointer — on that route, and not on
        // the menu, where the buttons are the surface.
        shellBackgroundInteractive: true,
        shellAudioAssets: actionShellAssetManifest,
        // The menu bed. Its clip declares an `outro` cue, which is what earns the
        // CUE-ALIGNED handoff into a match rather than a fade timed from the
        // moment the player pressed Start (§4.25).
        shellMusicBed: {
            ref: actionShellAudioRefs.menuBed,
            volume: 0.6,
            fadeInMs: 800,
        },
        // The game-owned route the menu's Start button navigates to. Declared
        // here and served by `renderer/app/select/page.tsx`; the two halves are
        // cross-checked statically by `tools/shell-page-routes.test.ts`, because
        // a declared route with no page is a static 404 the renderer never
        // observes at runtime.
        shellRoutes: ['/select'],
        translations: ACTION_TRANSLATIONS,
        // The rebindable action table (§4.26). Statically imported, unlike the
        // modules above: it is plain data with no DOM or React in it, so a
        // dynamic import would buy a chunk boundary for one small literal.
        // Carrying it on the SHELL payload is what lets the engine register it at
        // app boot — before a lobby, before a match — so Settings > Controls
        // lists both key clusters and the `/select` page's rings move on them.
        inputActions: ACTION_INPUT_ACTIONS,
    };
}

/**
 * The game's contributed i18n bundle.
 *
 * `languages` is the manifest's own declared list, NOT `resolveGameLanguages`'
 * resolved one: that helper answers `undefined` below two entries — the
 * single-language path, where the engine hides the selector — and an empty list
 * here would make the app's only bundle read as undeclared, which the registry
 * loader dev-warns about on every shell load.
 */
const ACTION_TRANSLATIONS: GameTranslations = {
    languages: actionManifest.languages ?? [],
    bundles: {
        'en-US': actionBundleEn,
    },
};
