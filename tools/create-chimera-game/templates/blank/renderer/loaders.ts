// __Game Title__'s renderer bundle loaders. Kept as dynamic `import()`s so the
// heavy screen/shell modules stay code-split while registration (register.ts)
// remains a cheap, eager side effect. The renderer seam calls these to load the
// game's screens and shell on demand.

import type { LoadedRendererGame, LoadedRendererGameShell } from '@chimera-engine/renderer/game';

import { __gameCamel__Manifest } from '../manifest.js';

export async function load__GamePascal__RendererGame(): Promise<LoadedRendererGame> {
    const screenModule = await import('../screens/index.js');
    return {
        registry: screenModule.__GamePascal__GameScreenRegistry,
    };
}

// No game-specific shell yet — the engine renders its default main menu,
// settings, lobby, and background. To customise them, add a `shell/` directory
// and return its definitions here (`mainMenu`, `menuCommands`, `settings`,
// `shellBackground`, `LobbyScreen`, `fonts`, `icons`); every field is optional.
export function load__GamePascal__RendererGameShell(): Promise<LoadedRendererGameShell> {
    return Promise.resolve({
        // The manifest's cursor declaration, forwarded verbatim: the renderer
        // seam turns it into `--ch-cursor-*` token overrides. Undeclared (the
        // manifest example commented out) ⇒ undefined ⇒ strict no-op.
        cursor: __gameCamel__Manifest.cursor,
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
