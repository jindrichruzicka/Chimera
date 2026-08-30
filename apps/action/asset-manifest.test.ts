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

import { ACTION_GAME_ID } from './simulation/constants.js';
import { actionAssetManifest } from './asset-manifest.js';

// Asset-manifest unit smoke. `pnpm validate:assets` already checks that every
// declared ref exists at build time, so this asserts what that gate does NOT:
// the manifest's own identity, and — for each entry — that the bytes on disk are
// the kind of file the entry says they are.
//
// The per-entry blocks are LOOPS, so they grow with the manifest rather than
// needing an edit per asset. With `entries` still empty every one of them is
// vacuous, which is why the emptiness itself is asserted below and each looping
// predicate is given a positive control on a synthetic entry: a loop over
// nothing and a loop whose body was deleted are indistinguishable otherwise.
const here = dirname(fileURLToPath(import.meta.url));

describe('actionAssetManifest', () => {
    it('claims the same game id the rest of the game is built from', () => {
        // The manifest's `gameId` is metadata; what actually resolves a file is
        // the FIRST SEGMENT of each ref string. They have to agree, and only
        // this says so — a mismatch sends every lookup into another game's
        // directory.
        expect(actionAssetManifest.gameId).toBe(ACTION_GAME_ID);
    });

    it('declares no entries yet — the arena is r3f geometry, not loaded files', () => {
        // States what makes the loops below vacuous today. When the first entry
        // lands this line is what says so out loud, rather than the suite
        // quietly starting to check something it never checked before.
        expect(actionAssetManifest.entries).toEqual([]);
    });

    it('declares each ref at most once', () => {
        // A duplicate ref with two different kinds silently keeps one of them.
        const refs = actionAssetManifest.entries.map((entry) => entry.ref);
        expect(new Set(refs).size).toBe(refs.length);
    });

    it('scopes every declared ref to this game', () => {
        for (const entry of actionAssetManifest.entries) {
            expect(parseAssetRef(entry.ref).gameId, entry.ref).toBe(ACTION_GAME_ID);
        }
    });

    it('would catch a ref scoped to another game (positive control)', () => {
        // The predicate the loop above runs, exercised on the entry shape the
        // loop would see. Without this the scoping check is a loop over nothing.
        expect(parseAssetRef('tactics/audio/sfx/step.wav').gameId).not.toBe(ACTION_GAME_ID);
        expect(parseAssetRef(`${ACTION_GAME_ID}/textures/floor.png`).gameId).toBe(ACTION_GAME_ID);
    });

    it('backs every declared ref with a file of the kind it claims', () => {
        for (const entry of actionAssetManifest.entries) {
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

    it('would resolve a declared ref under this app’s own assets dir (positive control)', () => {
        // `assetPathForRef` is the other half of the loop above, and the half
        // that decides WHERE a missing file is looked for. A resolver pointed at
        // another game's directory would report every ref missing — or, worse,
        // find a same-named file there.
        expect(assetPathForRef(here, `${ACTION_GAME_ID}/textures/floor.png`)).toBe(
            `${here}/assets/textures/floor.png`,
        );
    });
});
