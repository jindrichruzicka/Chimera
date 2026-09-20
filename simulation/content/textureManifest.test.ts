/**
 * simulation/content/textureManifest.test.ts
 *
 * Unit tests for the `textureEntry` authoring builder: the helper games call to
 * declare a `'texture'` manifest entry together with how it is sampled.
 *
 * Architecture reference: §4.10 — Asset Reference System.
 *
 * Invariants upheld:
 *   #1 — `simulation/` has zero runtime dependencies on React, DOM, or a
 *     graphics library, so sampling values are engine-owned names and JSON
 *     scalars.
 *   §3 Module Boundary — `simulation/content/` imports only within `simulation/`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import { buildAssetRef, type TextureAsset } from './AssetRef';
import type { AssetManifestEntry } from './AssetManifest';
import * as contentBarrel from './index';
import { InvalidTextureSamplingError, textureEntry, type TextureSampling } from './textureManifest';

const ref = buildAssetRef<TextureAsset>('tactics', 'textures/banner.png');

const EVERY_OPTION: TextureSampling = {
    colorSpace: 'none',
    magFilter: 'nearest',
    minFilter: 'nearest-mipmap-linear',
    wrapS: 'repeat',
    wrapT: 'clamp',
    flipY: false,
    anisotropy: 8,
    generateMipmaps: false,
};

describe('textureEntry', () => {
    it('builds a `texture` entry carrying every declared option under `metadata.sampling`', () => {
        const entry = textureEntry({ ref, priority: 'critical', sampling: EVERY_OPTION });

        expect(entry).toEqual({
            ref,
            kind: 'texture',
            priority: 'critical',
            metadata: {
                sampling: {
                    colorSpace: 'none',
                    magFilter: 'nearest',
                    minFilter: 'nearest-mipmap-linear',
                    wrapS: 'repeat',
                    wrapT: 'clamp',
                    flipY: false,
                    anisotropy: 8,
                    generateMipmaps: false,
                },
            },
        });
    });

    it('omitting sampling yields a behaviour-neutral entry with no `metadata` key', () => {
        const entry = textureEntry({ ref, priority: 'deferred' });

        expect(entry).toEqual({ ref, kind: 'texture', priority: 'deferred' });
        expect(Object.hasOwn(entry, 'metadata')).toBe(false);
    });

    it('returns exactly an `AssetManifestEntry<TextureAsset>`', () => {
        expectTypeOf(textureEntry).returns.toEqualTypeOf<AssetManifestEntry<TextureAsset>>();
    });

    it('rejects a misspelled option at compile time', () => {
        expect(() =>
            textureEntry({
                ref,
                priority: 'deferred',
                // @ts-expect-error: 'colourSpace' is not a sampling option
                sampling: { colourSpace: 'srgb' },
            }),
        ).toThrow(InvalidTextureSamplingError);
    });

    it('rejects a misspelled option that reaches it past the type checker', () => {
        // A spread defeats excess-property checking, so the type alone is not the
        // whole guard: the builder refuses the value too.
        const typo = { flipY: false, colourSpace: 'srgb' };
        const sampling: TextureSampling = { ...typo };

        expect(() => textureEntry({ ref, priority: 'deferred', sampling })).toThrow(
            new InvalidTextureSamplingError(['sampling.colourSpace is not a sampling option.']),
        );
    });

    it('rejects an invalid value rather than carrying it to the loader', () => {
        const sampling = { magFilter: 'pixelated' } as unknown as TextureSampling;

        expect(() => textureEntry({ ref, priority: 'deferred', sampling })).toThrow(
            new InvalidTextureSamplingError([
                "sampling.magFilter must be one of 'nearest', 'linear'.",
            ]),
        );
    });

    it('is published, with its error type, on the content barrel', () => {
        expect(contentBarrel.textureEntry).toBe(textureEntry);
        expect(contentBarrel.InvalidTextureSamplingError).toBe(InvalidTextureSamplingError);
        expect(contentBarrel.DEFAULT_TEXTURE_COLOR_SPACE).toBe('srgb');
    });

    it('builds an entry that survives a JSON round trip unchanged', () => {
        const entry = textureEntry({ ref, priority: 'critical', sampling: EVERY_OPTION });

        expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    });
});
