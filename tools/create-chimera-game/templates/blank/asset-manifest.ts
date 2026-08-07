// __Game Title__'s asset manifest — the complete inventory of the files this game
// loads at runtime, and the only place a loadable asset is named.
//
// It starts empty on purpose. What matters is that it is DECLARED and WIRED
// (`renderer/loaders.ts` forwards it), because that wiring is the part a game
// cannot discover for itself: `LoadedRendererGame.assetManifest` is optional, so a
// game that never returns one compiles, typechecks, lints and passes
// `pnpm validate:assets` — and then every single asset load rejects at runtime with
// `UnknownAssetManifestEntryError`, because the manager was handed no inventory to
// resolve against. Adding your first asset should be an entry in the array below,
// nothing more.
//
// THE REF GRAMMAR. A ref is `'<gameId>/<path under this game's assets/ dir>'`.
// `'__game_kebab__/textures/banner.png'` resolves to
// `assets/textures/banner.png` beside this file (a game's assets are its own,
// never the engine's). The FIRST SEGMENT of the ref string is what
// resolves; the `gameId` field below is not consulted for it, so the two must
// agree or `validate:assets` will look for your files under another game's
// directory.
//
// LOADER COVERAGE. `kind` selects the loader the engine resolves the file with;
// the set it registers is `createDefaultAssetLoaderRegistry` in the renderer's
// asset layer, and a `kind` with no loader throws `UnknownAssetKindError` on
// first use rather than at build time.
//
// PRIORITY. `deferred` loads on first use and is the right default. `critical`
// preloads before the game starts — reach for it only when loading-on-demand is
// visibly too late, as it is for a music bed that must fade in on cue.
//
// NAME EVERY REF ONCE, HERE. Screens import the const rather than retyping the
// string, so a typo is a compile error instead of a runtime miss — and
// `validate:assets` can only follow a `<Const>.<member>` argument back to a ref
// when that const is declared in THIS file.

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
// Uncomment alongside your first entry:
// import type { AssetRef, TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import { __GAME_CONSTANT___GAME_ID } from './simulation/constants.js';

// A worked example — declare your refs as a const, then reference them from both
// the manifest below and the screens that load them:
//
// export const __gameCamel__TextureRefs = {
//     banner: '__game_kebab__/textures/banner.png' as AssetRef<TextureAsset>,
// } as const;

export const __gameCamel__AssetManifest: AssetManifest = {
    gameId: __GAME_CONSTANT___GAME_ID,
    entries: [
        // { ref: __gameCamel__TextureRefs.banner, kind: 'texture', priority: 'deferred' },
    ],
};
