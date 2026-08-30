// The action app's renderer bundle loaders. The renderer host names no game —
// it is a runtime injection seam — so the game's renderer contribution lives
// here in the consumer app. The dynamic imports keep the heavy screen modules
// code-split, and use relative paths because this file is part of the
// `@chimera-engine/action` library build.
//
// Font loading is intentionally NOT performed here: the renderer seam's
// `loadRendererGame` / `loadRendererGameShell` wrappers call `loadGameFonts` on
// the returned `shell.fonts`, keeping the renderer-internal `GameFontLoader` out
// of this game package (it is not a public `@chimera-engine/renderer` barrel).

import type { LoadedRendererGame, LoadedRendererGameShell } from '@chimera-engine/renderer/game';

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
 * The shell payload.
 *
 * One field so far, and it is the one that has to be here rather than on the
 * match payload: carrying `inputActions` on the SHELL is what lets the engine
 * register them at app boot — before a lobby, before a match — so Settings >
 * Controls lists the arrow keys and a rebind sticks on a menu route.
 */
export async function loadActionRendererGameShell(): Promise<LoadedRendererGameShell> {
    // Awaited, not fire-and-forget: the shell renders as soon as this resolves,
    // and tokens installed after first paint are a visible flash of the engine
    // defaults.
    await import('../styles/register-token-overrides.js');

    return {
        // Statically imported, unlike the screen modules above: it is plain data
        // with no DOM or React in it, so a dynamic import would buy a chunk
        // boundary for one small literal.
        inputActions: ACTION_INPUT_ACTIONS,
    };
}
