// __Game Title__'s renderer bundle loaders. Kept as dynamic `import()`s so the
// heavy screen/shell modules stay code-split while registration (register.ts)
// remains a cheap, eager side effect. The renderer seam calls these to load the
// game's screens and shell on demand.

import type { LoadedRendererGame, LoadedRendererGameShell } from '@chimera-engine/renderer/game';

export async function load__GamePascal__RendererGame(): Promise<LoadedRendererGame> {
    const screenModule = await import('../screens/index.js');
    return {
        registry: screenModule.__GamePascal__GameScreenRegistry,
    };
}

// No game-specific shell yet — the engine renders its default main menu,
// settings, lobby, and background. To customise them, add a `shell/` directory
// and return its definitions here (`mainMenu`, `menuCommands`, `settings`,
// `shellBackground`, `LobbyScreen`, `fonts`); every field is optional.
export function load__GamePascal__RendererGameShell(): Promise<LoadedRendererGameShell> {
    return Promise.resolve({});
}
