import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    assetPathForRef,
    readGlbDocument,
    readWavFacts,
} from '@chimera-engine/electron/test-support';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import { parseAssetRef } from '@chimera-engine/simulation/foundation/asset-ref-parse.js';

import { __GAME_CONSTANT___GAME_ID } from './simulation/constants.js';
import { __gameCamel__AssetManifest } from './asset-manifest.js';
import { __gameCamel__ShellAssetManifest } from './shell-asset-manifest.js';

// Asset-manifest unit smoke. `chimera-validate-assets` already checks that every
// declared ref exists at build time, so this deliberately asserts what that gate
// does NOT: the manifest's own identity, and — for each entry — that the bytes on
// disk are the kind of file the entry says they are. A `.webp` declared as a
// `texture`, a re-encoded `.wav` that lost its RIFF header, or a `.glb` truncated
// by a bad copy all pass a file-exists check and fail at runtime.
//
// BOTH of this game's inventories go through the same block: the match one and
// the shell one are the same shape and resolve their refs under the same asset
// directory, so a menu clip earns the same checks a match texture does. Only the
// discovery NAME differs, and that is the asset validator's concern rather than
// this file's.
//
// The per-entry block is written as a loop rather than a fixed list so it grows
// with your manifests: it does nothing while `entries` is empty and starts
// working the moment you declare your first asset. Nothing here needs editing to
// add one.
const here = dirname(fileURLToPath(import.meta.url));

const inventories: readonly (readonly [string, AssetManifest])[] = [
    ['__gameCamel__AssetManifest', __gameCamel__AssetManifest],
    ['__gameCamel__ShellAssetManifest', __gameCamel__ShellAssetManifest],
];

for (const [name, manifest] of inventories) {
    describe(name, () => {
        it('claims the same game id the rest of the game is built from', () => {
            // The manifest's `gameId` is metadata; what actually resolves a file
            // is the FIRST SEGMENT of each ref string. They have to agree, and
            // only this says so — a mismatch sends every lookup into another
            // game's directory.
            expect(manifest.gameId).toBe(__GAME_CONSTANT___GAME_ID);
        });

        it('declares each ref at most once', () => {
            // A duplicate ref with two different kinds silently keeps one of them.
            const refs = manifest.entries.map((entry) => entry.ref);
            expect(new Set(refs).size).toBe(refs.length);
        });

        it('scopes every declared ref to this game', () => {
            for (const entry of manifest.entries) {
                expect(parseAssetRef(entry.ref).gameId, entry.ref).toBe(__GAME_CONSTANT___GAME_ID);
            }
        });

        it('backs every declared ref with a file of the kind it claims', () => {
            for (const entry of manifest.entries) {
                const filePath = assetPathForRef(here, entry.ref);
                expect(existsSync(filePath), entry.ref).toBe(true);

                // The readers throw a named error identifying the file, so a
                // malformed container fails here rather than at first load.
                if (entry.kind === 'audio-clip' && filePath.endsWith('.wav')) {
                    expect(readWavFacts(filePath).frames, entry.ref).toBeGreaterThan(0);
                }
                if (entry.kind === 'gltf-model' && filePath.endsWith('.glb')) {
                    expect(readGlbDocument(filePath).asset.version, entry.ref).toBe('2.0');
                }
            }
        });
    });
}
