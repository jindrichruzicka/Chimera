// The action app's asset manifest — the inventory of the files a match loads at
// runtime.
//
// It starts EMPTY, and the empty declaration is the point: `assetManifest` is
// optional on `LoadedRendererGame`, so a game that never returns one compiles,
// typechecks, lints and passes `validate:assets` — and then every asset load
// rejects at runtime with `UnknownAssetManifestEntryError`, because the manager
// was handed no inventory to resolve against. Declared and forwarded from
// `renderer/loaders.ts` from the start, so the first entry added below simply
// works.
//
// The arena needs none yet: the three primitives and the floor are r3f geometry
// with plain materials, not loaded files. The shell's own inventory is a
// SEPARATE file (`shell-asset-manifest.ts`) that the shell task adds — the two
// names `validate:assets` reads a shell manifest from are
// `shellBackgroundAssets` and `shellAudioAssets`, both forwarded from the shell
// loader, and neither is this one.

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';

import { ACTION_GAME_ID } from './simulation/constants.js';

export const actionAssetManifest: AssetManifest = {
    gameId: ACTION_GAME_ID,
    entries: [],
};
