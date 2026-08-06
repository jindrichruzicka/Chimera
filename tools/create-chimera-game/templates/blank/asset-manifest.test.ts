import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    assetPathForRef,
    readGlbDocument,
    readWavFacts,
} from '@chimera-engine/electron/test-support';
import { parseAssetRef } from '@chimera-engine/simulation/foundation/asset-ref-parse.js';

import { __GAME_CONSTANT___GAME_ID } from './simulation/constants.js';
import { __gameCamel__AssetManifest } from './asset-manifest.js';

// Asset-manifest unit smoke. `chimera-validate-assets` already checks that every
// declared ref exists at build time, so this deliberately asserts what that gate
// does NOT: the manifest's own identity, and — for each entry — that the bytes on
// disk are the kind of file the entry says they are. A `.webp` declared as a
// `texture`, a re-encoded `.wav` that lost its RIFF header, or a `.glb` truncated
// by a bad copy all pass a file-exists check and fail at runtime.
//
// The per-entry block is written as a loop rather than a fixed list so it grows
// with your manifest: it does nothing while `entries` is empty and starts working
// the moment you declare your first asset. Nothing here needs editing to add one.
const here = dirname(fileURLToPath(import.meta.url));

describe('__gameCamel__AssetManifest', () => {
    it('claims the same game id the rest of the game is built from', () => {
        // The manifest's `gameId` is metadata; what actually resolves a file is
        // the FIRST SEGMENT of each ref string. They have to agree, and only this
        // says so — a mismatch sends every lookup into another game's directory.
        expect(__gameCamel__AssetManifest.gameId).toBe(__GAME_CONSTANT___GAME_ID);
    });

    it('declares each ref at most once', () => {
        // A duplicate ref with two different kinds silently keeps one of them.
        const refs = __gameCamel__AssetManifest.entries.map((entry) => entry.ref);
        expect(new Set(refs).size).toBe(refs.length);
    });

    it('scopes every declared ref to this game', () => {
        for (const entry of __gameCamel__AssetManifest.entries) {
            expect(parseAssetRef(entry.ref).gameId, entry.ref).toBe(__GAME_CONSTANT___GAME_ID);
        }
    });

    it('backs every declared ref with a file of the kind it claims', () => {
        for (const entry of __gameCamel__AssetManifest.entries) {
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
