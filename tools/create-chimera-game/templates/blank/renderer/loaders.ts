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
    };
}

// The engine renders its default main menu, settings, lobby, and background.
// Only the `shell/fonts.ts` declaration site is wired so far; every other
// `LoadedRendererGameShell` field (`mainMenu`, `settings`, `icons`, …) is an
// optional customisation returned here.
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
