// __Game Title__'s SHELL inventory — what the menu screens sound, and what a
// game-owned menu background renders. Loaded OUTSIDE a match, through owners of
// its own, so it is an inventory this game ships separately from the match's
// `asset-manifest.ts`.
//
// A separate FILE, and the separation is a build fact rather than taste:
// `chimera-validate-assets` tells a shell inventory from a match one by the
// file's NAME, and these two basenames are the only ones it opens. A shell
// inventory under any other name is not a manifest that fails to validate; it is
// one the gate never reads.
//
// Empty and already wired — `renderer/loaders.ts` forwards it as both
// `shellAudioAssets` and `shellBackgroundAssets` — so the first clip a menu
// plays, or the first texture a menu background loads, is one entry below and
// nothing else. The two fields resolve through different owners (the
// background's manager publishes to its own subtree; the audio one becomes the
// app-level delegate the sound hooks reach), which is why a game that wants both
// points both at this one file. Forwarding `shellAudioAssets` while it is empty
// is not free the way an absent field is: the engine opens an asset session over
// it on the shell screens. It resolves nothing and sounds nothing, and it is
// what makes the first clip added below play without a second edit.
//
// The ref grammar, the `kind` set and the `priority` choice are the ones
// `asset-manifest.ts` writes out in full; a ref declared here resolves under
// this game's own `assets/` directory exactly as a match ref does. A menu bed is
// the one case where `critical` is the obvious priority: a loop that streamed in
// after the menu painted would start late.

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
// Uncomment alongside your first clip:
// import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import { __GAME_CONSTANT___GAME_ID } from './simulation/constants.js';

// A worked example — name each ref once as a const, then reference it from the
// manifest below and from whatever plays it (a `shellMusicBed` declaration in
// `renderer/loaders.ts`, a `useSound` call on a menu surface):
//
// export const __gameCamel__ShellAudioRefs = {
//     menuBed: '__game_kebab__/audio/music/menu-bed.wav' as AssetRef<AudioClipAsset>,
// } as const;

export const __gameCamel__ShellAssetManifest: AssetManifest = {
    gameId: __GAME_CONSTANT___GAME_ID,
    entries: [
        // { ref: __gameCamel__ShellAudioRefs.menuBed, kind: 'audio-clip', priority: 'critical' },
    ],
};
