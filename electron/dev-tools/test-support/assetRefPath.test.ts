import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MalformedAssetRefError } from '@chimera-engine/simulation/content/AssetRef.js';

import { assetPathForRef } from './assetRefPath.js';

describe('assetPathForRef', () => {
    it('resolves a declared ref against the game directory it belongs to', () => {
        expect(assetPathForRef('/games/tactics', 'tactics/audio/sfx/step.wav')).toBe(
            path.join('/games/tactics', 'assets', 'audio/sfx/step.wav'),
        );
    });

    it('drops only the game-id segment, keeping the rest of the path intact', () => {
        // The ref's first segment names the game; everything after it is relative
        // to `assets/`. Slicing a fixed prefix length instead would truncate any
        // game whose id is not the one the caller assumed.
        expect(assetPathForRef('/g', 'a-longer-game-id/models/rig.glb')).toBe(
            path.join('/g', 'assets', 'models/rig.glb'),
        );
    });

    it('does not require the ref game id to match the directory name', () => {
        // A scaffolded game is renamed by moving its directory; the ref's first
        // segment is the gameId, which need not equal the folder. Assert on the
        // ref itself when that correspondence matters — this resolves, it does
        // not police.
        expect(assetPathForRef('/anywhere', 'tactics/icons/icon.png')).toBe(
            path.join('/anywhere', 'assets', 'icons/icon.png'),
        );
    });

    it('rejects a ref with no game-id segment', () => {
        expect(() => assetPathForRef('/g', 'step.wav')).toThrow(MalformedAssetRefError);
    });

    it('rejects a traversal that would escape the assets root', () => {
        // `assets/../../etc/passwd` resolves outside the game. The engine's own
        // parser owns this rule, so a test helper cannot drift from the runtime.
        expect(() => assetPathForRef('/g', 'tactics/../../etc/passwd')).toThrow(
            MalformedAssetRefError,
        );
    });

    it('rejects an absolute relative-path segment', () => {
        expect(() => assetPathForRef('/g', 'tactics//etc/passwd')).toThrow(MalformedAssetRefError);
    });
});
