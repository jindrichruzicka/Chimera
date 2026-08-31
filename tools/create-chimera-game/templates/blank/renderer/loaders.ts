// __Game Title__'s renderer bundle loaders — the ONE module that hands the
// engine this game's renderer contribution. Every optional shell feature is
// turned on from here.
//
// WHAT EACH FIELD DOES, and what turning it on costs, is in
// `shell-contributions.md` beside this file. It lives there rather than here
// because this is a file you edit: prose next to an edited line goes stale
// before a doc does.
//
// Two rules this file's SHAPE encodes, both of which a plain refactor breaks
// silently:
//
//   - Everything imported STATICALLY here is loaded on every screen the shell
//     mounts, main menu included. A static import must therefore be plain
//     data — no React, no `three`. The slots a game fills with its own
//     interface go through `shell/contributions.tsx`, imported dynamically.
//   - `SHELL_ROUTES` has to stay a `const` array literal IN THIS FILE if this
//     game lives inside the Chimera monorepo. The check that pairs each
//     declared route with a real page reads the initializer out of this source
//     text and follows no import, so a constant moved to a module of its own
//     reads as unreadable — which turns that check OFF for the game rather than
//     failing it, and a declared route with no page is a static 404 nothing
//     observes at runtime. A standalone project ships no such check, and gets
//     the 404 with nothing to warn about it.

import type {
    GameShellMusicBed,
    GameTranslations,
    LoadedRendererGame,
    LoadedRendererGameShell,
} from '@chimera-engine/renderer/game';

import { __gameCamel__Manifest } from '../manifest.js';
import { __gameCamel__ShellAssetManifest } from '../shell-asset-manifest.js';
import { gameFonts } from '../shell/fonts.js';
import { __GamePascal__INPUT_ACTIONS } from './input-actions.js';

// ─── The values you edit ─────────────────────────────────────────────────────

/**
 * This game's OWN Next routes, promoted to first-class shell pages: declare
 * `['/credits']`, add `renderer/app/credits/page.tsx`, and the menu background
 * persists behind it, a menu `navigate` reaches it with the game context
 * preserved, and a match started from it lands in the game screen.
 *
 * Declared as a same-file array literal on purpose — see the second rule above.
 */
const SHELL_ROUTES: readonly `/${string}`[] = [];

/** Let a game-owned menu background take pointer input. Inert without one. */
const SHELL_BACKGROUND_INTERACTIVE = false;

/**
 * The looping menu bed, played across the shell screens and handed off when a
 * match starts. Inert until `shell-asset-manifest.ts` declares the clip it
 * names, because that manifest is what resolves the ref.
 */
const SHELL_MUSIC_BED: GameShellMusicBed | undefined = undefined;

/**
 * Shell images to fetch and decode while the game loads, as game asset refs, so
 * a menu hero paints in one frame instead of streaming in. Best-effort: a broken
 * ref warns and never blocks the shell.
 */
const PRELOAD_IMAGES: readonly string[] = [];

/**
 * Handlers for this game's OWN menu commands, by id. A `mainMenu` button
 * declaring `{ type: 'command', commandId }` needs an entry here: rendering the
 * menu THROWS on a command id no handler is registered for, rather than
 * ignoring the button. The engine's own buttons declare no command, so an empty
 * map is right until this game's menu declares one.
 */
const MENU_COMMANDS: NonNullable<LoadedRendererGameShell['menuCommands']> = {};

/**
 * This game's UI translation bundles, layered over the engine's English. The
 * declared language list comes from the manifest, so the two cannot disagree
 * about which locales this game offers; a bundle for a locale the manifest does
 * not declare is one the provider will never select.
 */
const TRANSLATIONS: GameTranslations = {
    languages: __gameCamel__Manifest.languages ?? [],
    bundles: {},
};

// ─── The payloads ────────────────────────────────────────────────────────────

/**
 * The MATCH payload: what a running game needs.
 *
 * `assetManifest` is OPTIONAL on `LoadedRendererGame`, and forwarding it while
 * it is still EMPTY is the point: a game that omits it compiles, typechecks,
 * lints and passes `validate:assets` clean, then rejects every asset load at
 * runtime with `UnknownAssetManifestEntryError`, because the manager resolves
 * refs against the inventory it was handed and it was handed none.
 */
export async function load__GamePascal__RendererGame(): Promise<LoadedRendererGame> {
    const [screenModule, assetManifestModule, shell] = await Promise.all([
        import('../screens/index.js'),
        import('../asset-manifest.js'),
        load__GamePascal__RendererGameShell(),
    ]);

    return {
        registry: screenModule.__GamePascal__GameScreenRegistry,
        assetManifest: assetManifestModule.__gameCamel__AssetManifest,
        // Read BACK off the shell rather than restated: the same array reaches
        // both payloads, so the engine's app-boot registration and the game
        // shell's cannot disagree about what an id means. Spread rather than
        // assigned because `exactOptionalPropertyTypes` refuses an explicit
        // `undefined` for an optional field.
        ...(shell.inputActions === undefined ? {} : { inputActions: shell.inputActions }),
        // The shell payload, carried on the MATCH payload — which is where the
        // engine's settings page reads a game's `settings` definition from.
        // Declaring `settings` on the shell payload alone leaves it unreachable,
        // because that page never calls the shell loader.
        shell,
    };
}

/**
 * The SHELL payload: what the menu, the settings pane and any game-owned shell
 * page need, loaded without the match.
 */
export async function load__GamePascal__RendererGameShell(): Promise<LoadedRendererGameShell> {
    // FIRST, and awaited. This installs `styles/tokens-override.css`; the shell
    // renders as soon as this loader resolves, so tokens that arrive after it
    // are a visible flash of the engine defaults rather than a theme.
    await import('../styles/register-token-overrides.js');

    const contributionsModule = await import('../shell/contributions.js');

    return {
        // The manifest's cursor declaration, forwarded verbatim: the renderer
        // seam turns it into `--ch-cursor-*` token overrides. Undeclared (the
        // manifest example commented out) ⇒ undefined ⇒ strict no-op.
        cursor: __gameCamel__Manifest.cursor,
        // Self-hosted font faces, empty until the app's `fetch:fonts` script
        // populates shell/fonts.ts.
        fonts: gameFonts,
        translations: TRANSLATIONS,
        menuCommands: MENU_COMMANDS,
        // Registered at app BOOT because they ride this payload — which is what
        // lists them in Settings > Controls before any match has run.
        inputActions: __GamePascal__INPUT_ACTIONS,
        shellAudioAssets: __gameCamel__ShellAssetManifest,
        shellBackgroundAssets: __gameCamel__ShellAssetManifest,
        shellBackgroundInteractive: SHELL_BACKGROUND_INTERACTIVE,
        shellRoutes: SHELL_ROUTES,
        preloadImages: PRELOAD_IMAGES,
        ...(SHELL_MUSIC_BED === undefined ? {} : { shellMusicBed: SHELL_MUSIC_BED }),
        ...contributionsModule.__gameCamel__ShellContributions,
    };
}
