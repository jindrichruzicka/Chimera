// __Game Title__'s shell UI contributions — the slots a game fills with its own
// interface rather than with a value.
//
// ONE module, imported dynamically by `renderer/loaders.ts`, for two reasons
// that both point the same way. Everything `loaders.ts` imports STATICALLY is
// loaded on every screen the shell mounts, main menu included, so a React
// component named there would put this game's rendering in front of the menu.
// And a slot per module would buy a chunk boundary per slot; these arrive
// together, so they cost one.
//
// `.tsx`, and that is load-bearing beyond the JSX: `chimera/no-game-renderer-internals`
// treats the `.jsx`/`.tsx` files under `shell/` as this game's renderer
// surfaces, so they may name the engine's public renderer barrels. The same file
// as plain `.ts` could not.
//
// `icons` ships EMPTY-but-wired, the way every other stub in this game does: an
// empty glyph set is exactly what contributing no glyph looks like, so an author
// adds one entry and it renders. The four below cannot ship that way, because
// each REPLACES an engine default outright rather than adding to it — an empty
// `mainMenu` is a menu with no buttons, not the engine's menu. They are
// commented out instead: uncomment a line, write the value beside it, and the
// engine default gives way.
//
// What each slot does, and what turning it on costs, is in
// `renderer/shell-contributions.md`.

import type { LoadedRendererGameShell } from '@chimera-engine/renderer/game';

export const __gameCamel__ShellContributions = {
    // Game-contributed UI icon glyphs, keyed `game.<gameId>.<name>`. Author them
    // on the engine `IconGlyph` contract — a `viewBox` plus fill-based `content`
    // carrying no `fill` of its own — and `<Icon name="game.…">` renders them
    // with currentColor and token sizing, exactly like a built-in:
    //     'game.__gameCamel__.banner': { viewBox: '0 0 24 24', content: <path d="…" /> },
    icons: {},
    // mainMenu: __gameCamel__MainMenuDefinition,
    // settings: __gameCamel__SettingsPageDefinition,
    // shellBackground: __GamePascal__ShellBackground,
    // LobbyScreen: __GamePascal__LobbyScreen,
} satisfies Partial<
    Pick<
        LoadedRendererGameShell,
        'LobbyScreen' | 'icons' | 'mainMenu' | 'settings' | 'shellBackground'
    >
>;
