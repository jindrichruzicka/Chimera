// __Game Title__'s renderer bundle loaders. Heavy screen/shell modules stay
// dynamic `import()`s so they remain code-split while registration
// (register.ts) stays a cheap, eager side effect; light data-only shell
// declarations (the font list) may load statically. The renderer seam calls
// these to load the game's screens and shell on demand.

import type { LoadedRendererGame, LoadedRendererGameShell } from '@chimera-engine/renderer/game';

import { __gameCamel__Manifest } from '../manifest.js';
import { gameFonts } from '../shell/fonts.js';

// `assetManifest` is OPTIONAL on `LoadedRendererGame`, and that is the trap this
// forward exists to close: a game that omits it compiles, typechecks, lints and
// passes `validate:assets` clean, then rejects every asset load at runtime with
// `UnknownAssetManifestEntryError` — the manager resolves refs against the
// inventory it was handed, and it was handed none. Forwarded from the start so
// the first entry added to `asset-manifest.ts` simply works.
export async function load__GamePascal__RendererGame(): Promise<LoadedRendererGame> {
    const [screenModule, assetManifestModule] = await Promise.all([
        import('../screens/index.js'),
        import('../asset-manifest.js'),
    ]);
    return {
        registry: screenModule.__GamePascal__GameScreenRegistry,
        assetManifest: assetManifestModule.__gameCamel__AssetManifest,
        inputActions: screenModule.__GamePascal__INPUT_ACTIONS,
    };
}

// The engine renders its default main menu, settings, lobby, and background.
// Only the `shell/fonts.ts` declaration site is wired so far; every other
// `LoadedRendererGameShell` field (`mainMenu`, `settings`, `icons`,
// `shellRoutes`, …) is an optional customisation returned here.
//
// Two of those are worth knowing about before the menu is customised:
//
//   - A `mainMenu` button may declare `{ type: 'start-game' }` to open a match
//     without the lobby UI (optionally with a `QuickStartConfig` naming match
//     settings and per-seat attributes) or `{ type: 'continue' }` to reload the
//     game's autosave. Neither navigates: the engine's snapshot gate carries the
//     player into the match, fade included. A button may also declare `confirm`
//     to ask first, through the engine's one confirm dialog.
//   - `shellBackground` replaces the engine's flat menu surface with a component
//     of this game's own. One that renders manifest assets also needs
//     `shellBackgroundAssets`: outside a match there is no game asset manager in
//     context, so every load rejects until the shell payload declares a manifest
//     for the engine to open a session around. Declare those refs in
//     `shell-asset-manifest.ts` at the app root — the asset validator reads that
//     name — and forward the manifest here.
//   - `shellRoutes` promotes this app's OWN Next routes — a credits screen, a
//     codex — to first-class shell pages: declare `['/credits']` here, add
//     `renderer/app/credits/page.tsx`, and the game background persists behind
//     it, a menu `navigate` reaches it with `?gameId=` preserved, and a match
//     started from it lands in `/game`. A declared route needs a real page in
//     this app's tree: the static export emits nothing for a route it cannot
//     find, so the navigation is a 404 the renderer never observes.
export function load__GamePascal__RendererGameShell(): Promise<LoadedRendererGameShell> {
    return Promise.resolve({
        // The manifest's cursor declaration, forwarded verbatim: the renderer
        // seam turns it into `--ch-cursor-*` token overrides. Undeclared (the
        // manifest example commented out) ⇒ undefined ⇒ strict no-op.
        cursor: __gameCamel__Manifest.cursor,
        // Self-hosted font faces, empty until the app's
        // `fetch:fonts` script populates shell/fonts.ts.
        fonts: gameFonts,
        // Game-contributed UI icon glyphs, keyed `game.<gameId>.<name>`. Author
        // them on the engine `IconGlyph` contract (a `viewBox` + fill-based
        // `content` with no `fill`) and the engine `<Icon name="game.…">` renders
        // them with currentColor + token sizing, exactly like a built-in —
        // including inside an `<IconButton>`. Add e.g. a `shell/icons.tsx`:
        //   import type { GameIconSet } from '@chimera-engine/renderer/components/ui';
        //   export const __gameCamel__Icons = {
        //       'game.__gameCamel__.banner': { viewBox: '0 0 24 24', content: <path d="…" /> },
        //   } as const satisfies GameIconSet;
        // then forward it here: `icons: __gameCamel__Icons,`.
    });
}
