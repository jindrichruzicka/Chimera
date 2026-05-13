import { describe, expect, it } from 'vitest';
import {
    type AssetKindBrand,
    type AssetKindId,
    type AssetRef,
    type AudioClipAsset,
    type GLTFModelAsset,
    type ParticleConfigAsset,
    type SpriteSheetAsset,
    type TextureAsset,
    MalformedAssetRefError,
    buildAssetRef,
    parseAssetRef,
} from './AssetRef';

interface TacticsVoxelAsset extends AssetKindBrand<'tactics:voxel'> {
    readonly __tacticsVoxelAsset: unique symbol;
}

declare module './AssetRef' {
    interface AssetKindRegistry {
        readonly 'tactics:voxel': TacticsVoxelAsset;
    }
}

// ---------------------------------------------------------------------------
// AssetRef<T> — Typed Asset References
// §4.8 / §4.10 — simulation/content/AssetRef.ts
// ---------------------------------------------------------------------------

describe('buildAssetRef', () => {
    it("produces a string with format 'gameId/relativePath'", () => {
        const ref = buildAssetRef('tactics', 'textures/units/warrior.webp');
        expect(ref).toBe('tactics/textures/units/warrior.webp');
    });

    it('accepts relative paths with multiple segments', () => {
        const ref = buildAssetRef('tactics', 'audio/sfx/sword-hit.ogg');
        expect(ref).toBe('tactics/audio/sfx/sword-hit.ogg');
    });

    it('round-trips through parseAssetRef', () => {
        const ref = buildAssetRef('tactics', 'models/units/warrior.glb');
        const parsed = parseAssetRef(ref);
        expect(parsed.gameId).toBe('tactics');
        expect(parsed.relativePath).toBe('models/units/warrior.glb');
    });

    it('accepts different gameIds', () => {
        const ref = buildAssetRef('puzzle', 'textures/bg.webp');
        expect(ref).toBe('puzzle/textures/bg.webp');
    });
});

describe('parseAssetRef', () => {
    it('returns gameId and relativePath for a valid ref', () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/terrain/grass.webp');
        const result = parseAssetRef(ref);
        expect(result).toEqual({
            gameId: 'tactics',
            relativePath: 'textures/terrain/grass.webp',
        });
    });

    it('handles relative paths that contain more than one slash', () => {
        const ref = 'tactics/textures/units/warrior-portrait.webp' as AssetRef<TextureAsset>;
        const result = parseAssetRef(ref);
        expect(result.gameId).toBe('tactics');
        expect(result.relativePath).toBe('textures/units/warrior-portrait.webp');
    });

    it('throws MalformedAssetRefError when no slash is present', () => {
        const bad = 'noslash' as AssetRef;
        expect(() => parseAssetRef(bad)).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when the slash is the first character (empty gameId)', () => {
        const bad = '/some/path.webp' as AssetRef;
        expect(() => parseAssetRef(bad)).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError with a message that includes the malformed ref', () => {
        const bad = 'noslash' as AssetRef;
        expect(() => parseAssetRef(bad)).toThrow(/AssetRef 'noslash' is malformed/);
    });
});

describe('buildAssetRef — path-traversal rejection', () => {
    it('throws MalformedAssetRefError when gameId is empty', () => {
        expect(() => buildAssetRef('', 'textures/grass.webp')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when relativePath contains a .. segment', () => {
        expect(() => buildAssetRef('tactics', '../etc/shadow')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when relativePath starts with /', () => {
        expect(() => buildAssetRef('tactics', '/absolute/path.png')).toThrow(
            MalformedAssetRefError,
        );
    });

    it('throws MalformedAssetRefError when relativePath contains a NUL byte', () => {
        expect(() => buildAssetRef('tactics', 'ok\0evil')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when gameId contains a slash', () => {
        expect(() => buildAssetRef('tac/tics', 'textures/grass.webp')).toThrow(
            MalformedAssetRefError,
        );
    });

    it('throws MalformedAssetRefError when relativePath has .. in a nested segment', () => {
        expect(() => buildAssetRef('tactics', 'textures/../../etc/shadow')).toThrow(
            MalformedAssetRefError,
        );
    });

    it('throws MalformedAssetRefError when gameId is ".."', () => {
        expect(() => buildAssetRef('..', 'textures/grass.webp')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when gameId is "."', () => {
        expect(() => buildAssetRef('.', 'textures/grass.webp')).toThrow(MalformedAssetRefError);
    });
});

describe('parseAssetRef — path-traversal rejection', () => {
    it('throws MalformedAssetRefError when relativePath contains ..', () => {
        const bad = 'tactics/../etc/shadow' as AssetRef;
        expect(() => parseAssetRef(bad)).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when relativePath starts with /', () => {
        // constructed directly to bypass buildAssetRef validation
        const bad = 'tactics//absolute' as AssetRef;
        expect(() => parseAssetRef(bad)).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when gameId is ".."', () => {
        const bad = '../textures/grass.webp' as AssetRef;
        expect(() => parseAssetRef(bad)).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when gameId is "."', () => {
        const bad = './textures/grass.webp' as AssetRef;
        expect(() => parseAssetRef(bad)).toThrow(MalformedAssetRefError);
    });
});

describe('MalformedAssetRefError', () => {
    it('is an instance of Error', () => {
        const err = new MalformedAssetRefError('bad-ref');
        expect(err).toBeInstanceOf(Error);
    });

    it('exposes the malformed ref on .ref', () => {
        const err = new MalformedAssetRefError('bad-ref');
        expect(err.ref).toBe('bad-ref');
    });

    it('has the exact descriptive message specified in §4.8', () => {
        const err = new MalformedAssetRefError('noslash');
        expect(err.message).toBe(
            "AssetRef 'noslash' is malformed — expected format: 'game-id/relative/path.ext'",
        );
    });
});

// ---------------------------------------------------------------------------
// Phantom asset-kind types — compile-time only; no runtime values
// ---------------------------------------------------------------------------

describe('AssetKind phantom types', () => {
    it('TextureAsset can be used as a generic parameter', () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        expect(typeof ref).toBe('string');
    });

    it('AudioClipAsset can be used as a generic parameter', () => {
        const ref = buildAssetRef<AudioClipAsset>('tactics', 'audio/sfx/hit.ogg');
        expect(typeof ref).toBe('string');
    });

    it('GLTFModelAsset can be used as a generic parameter', () => {
        const ref = buildAssetRef<GLTFModelAsset>('tactics', 'models/warrior.glb');
        expect(typeof ref).toBe('string');
    });

    it('SpriteSheetAsset can be used as a generic parameter', () => {
        const ref = buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/warrior-idle.webp');
        expect(typeof ref).toBe('string');
    });

    it('ParticleConfigAsset can be used as a generic parameter', () => {
        const ref = buildAssetRef<ParticleConfigAsset>('tactics', 'particles/blood-burst.json');
        expect(typeof ref).toBe('string');
    });

    it('game packages can extend AssetKindRegistry with custom phantom kinds', () => {
        const ref = buildAssetRef<TacticsVoxelAsset>('tactics', 'voxels/castle.vox');
        const customKind: AssetKindId<TacticsVoxelAsset> = 'tactics:voxel';

        expect(ref).toBe('tactics/voxels/castle.vox');
        expect(customKind).toBe('tactics:voxel');
    });
});

// ---------------------------------------------------------------------------
// Nominal brand discrimination — compile-time only (verified by pnpm typecheck)
// ---------------------------------------------------------------------------

describe('AssetKind nominal brand discrimination', () => {
    it('different AssetKind types produce incompatible AssetRef types at compile time', () => {
        // The @ts-expect-error below is the assertion: if the brands ever become
        // structurally identical again, TypeScript emits "Unused '@ts-expect-error'
        // directive" during pnpm typecheck — making this test red at the type level.
        const textureRef = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        // @ts-expect-error — AssetRef<TextureAsset> must not be assignable to AssetRef<AudioClipAsset>
        const _audioRef: AssetRef<AudioClipAsset> = textureRef;
        void _audioRef;
    });

    it('custom AssetRef types remain incompatible with built-in AssetRef types', () => {
        const voxelRef = buildAssetRef<TacticsVoxelAsset>('tactics', 'voxels/castle.vox');
        // @ts-expect-error — AssetRef<TacticsVoxelAsset> must not be assignable to AssetRef<TextureAsset>
        const _textureRef: AssetRef<TextureAsset> = voxelRef;
        void _textureRef;
    });
});

// AssetManifest structural tests live in AssetManifest.test.ts (§4.10).
