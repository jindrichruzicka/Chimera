/**
 * renderer/assets/AssetManager.sampling.test.ts
 *
 * The default `texture` and `sprite-sheet` loaders apply the sampling a manifest
 * entry declares BEFORE the texture is published (§4.10): what `load()` resolves
 * and what `get()` returns is already configured, so no consumer has a
 * configuration step of its own.
 *
 * Only `TextureLoader` is replaced — by a loader that decodes nothing and hands
 * back a real `Texture`, wrapped so every write to it is recorded — so the values
 * asserted are three's own.
 */

import type * as Three from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const textureLoads = vi.hoisted(() => ({
    urls: [] as string[],
    /** Every property write to a loaded texture, in order. */
    writes: [] as { readonly property: string; readonly afterPublication: boolean }[],
    published: false,
}));

vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal<typeof Three>();
    return {
        ...actual,
        TextureLoader: class TextureLoader {
            load(url: string, onLoad: (texture: unknown) => void): void {
                textureLoads.urls.push(url);
                // Observed from the moment the loader hands it over: everything
                // written before that is three's own construction.
                onLoad(
                    new Proxy(new actual.Texture(), {
                        set(target, property, value): boolean {
                            textureLoads.writes.push({
                                property: String(property),
                                afterPublication: textureLoads.published,
                            });
                            return Reflect.set(target, property, value);
                        },
                    }),
                );
            }
        },
    };
});

import * as THREE from 'three';

import {
    buildAssetRef,
    type SpriteSheetAsset,
    type TextureAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManifestEntry } from '@chimera-engine/simulation/content/AssetManifest.js';
import { spriteAnimationEntry } from '@chimera-engine/simulation/content/animationManifest.js';
import { textureEntry } from '@chimera-engine/simulation/content/textureManifest.js';
import { InvalidTextureSamplingError } from '@chimera-engine/simulation/foundation/texture-sampling.js';

import { DefaultAssetManager } from './AssetManager';

function managerFor(entries: readonly AssetManifestEntry[]): DefaultAssetManager {
    return new DefaultAssetManager({ resolve: (ref) => `resolved://${ref}` }, undefined, {
        gameId: 'tactics',
        entries,
    });
}

function samplingFieldsOf(texture: THREE.Texture): Readonly<Record<string, unknown>> {
    return {
        colorSpace: texture.colorSpace,
        magFilter: texture.magFilter,
        minFilter: texture.minFilter,
        wrapS: texture.wrapS,
        wrapT: texture.wrapT,
        flipY: texture.flipY,
        anisotropy: texture.anisotropy,
        generateMipmaps: texture.generateMipmaps,
    };
}

const PIXEL_ART = {
    colorSpace: 'srgb',
    magFilter: 'nearest',
    minFilter: 'nearest',
    generateMipmaps: false,
} as const;

const PIXEL_ART_FIELDS = {
    colorSpace: THREE.SRGBColorSpace,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    generateMipmaps: false,
};

afterEach(() => {
    textureLoads.urls.length = 0;
    textureLoads.writes.length = 0;
    textureLoads.published = false;
    vi.unstubAllGlobals();
});

describe('the default texture loader', () => {
    it('publishes a texture that already carries its declared color space and filtering', async () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/banner.png');
        const manager = managerFor([
            textureEntry({ ref, priority: 'deferred', sampling: PIXEL_ART }),
        ]);

        const loaded = await manager.load(ref);

        expect(samplingFieldsOf(loaded)).toMatchObject(PIXEL_ART_FIELDS);
        // The synchronous read a component makes every frame sees the same object.
        expect(manager.get(ref)).toBe(loaded);
    });

    it('publishes a texture whose entry declares no sampling as sRGB, and writes nothing else', async () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/plain.png');
        const manager = managerFor([textureEntry({ ref, priority: 'deferred' })]);

        const loaded = await manager.load(ref);

        expect(samplingFieldsOf(loaded)).toEqual({
            ...samplingFieldsOf(new THREE.Texture()),
            colorSpace: THREE.SRGBColorSpace,
        });
        expect(textureLoads.writes.map((write) => write.property)).toEqual(['colorSpace']);
    });

    it('defaults the color space of an entry that declares other options only', async () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/tiles.png');
        const manager = managerFor([
            textureEntry({ ref, priority: 'deferred', sampling: { wrapS: 'repeat' } }),
        ]);

        const loaded = await manager.load(ref);

        expect(samplingFieldsOf(loaded)).toEqual({
            ...samplingFieldsOf(new THREE.Texture()),
            colorSpace: THREE.SRGBColorSpace,
            wrapS: THREE.RepeatWrapping,
        });
    });

    it.each([
        ['none', THREE.NoColorSpace],
        ['srgb-linear', THREE.LinearSRGBColorSpace],
    ] as const)(
        'lets an entry declaring colorSpace %s override the default',
        async (colorSpace, expected) => {
            const ref = buildAssetRef<TextureAsset>('tactics', 'textures/roughness.png');
            const manager = managerFor([
                textureEntry({ ref, priority: 'deferred', sampling: { colorSpace } }),
            ]);

            const loaded = await manager.load(ref);

            expect(loaded.colorSpace).toBe(expected);
        },
    );

    it('hands two consumers of one ref the same texture, configured once and never written to again', async () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/banner.png');
        const manager = managerFor([
            textureEntry({ ref, priority: 'deferred', sampling: PIXEL_ART }),
        ]);

        // Two consumers asking while the load is still in flight …
        const [first, second] = await Promise.all([manager.load(ref), manager.load(ref)]);
        textureLoads.published = true;
        // … and a third arriving after it was published.
        const third = await manager.load(ref);

        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(manager.get(ref)).toBe(first);
        expect(textureLoads.urls).toEqual(['resolved://tactics/textures/banner.png']);
        expect(samplingFieldsOf(first)).toMatchObject(PIXEL_ART_FIELDS);
        expect(textureLoads.writes.map((write) => write.property).sort()).toEqual([
            'colorSpace',
            'generateMipmaps',
            'magFilter',
            'minFilter',
        ]);
        expect(textureLoads.writes.filter((write) => write.afterPublication)).toEqual([]);
    });

    it('rejects a hand-authored entry with an invalid sampling without requesting the image', async () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/banner.png');
        const manager = managerFor([
            {
                ref,
                kind: 'texture',
                priority: 'deferred',
                metadata: { sampling: { magFiler: 'nearest' } },
            },
        ]);

        await expect(manager.load(ref)).rejects.toThrow(
            new InvalidTextureSamplingError(['sampling.magFiler is not a sampling option.']),
        );
        expect(textureLoads.urls).toEqual([]);
        expect(manager.get(ref)).toBeNull();
    });
});

describe('the default sprite-sheet loader', () => {
    it('configures a plain sheet image the way the texture loader does', async () => {
        const ref = buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/hero.png');
        const manager = managerFor([
            spriteAnimationEntry({
                ref,
                priority: 'deferred',
                metadata: { clips: { walk: { frames: [0, 1], durationSeconds: 0.5 } } },
                sampling: PIXEL_ART,
            }),
        ]);

        const loaded = await manager.load(ref);

        expect(textureLoads.urls).toEqual(['resolved://tactics/sprites/hero.png']);
        expect(samplingFieldsOf(loaded.texture)).toMatchObject(PIXEL_ART_FIELDS);
    });

    it('publishes a plain sheet that declares no sampling as sRGB', async () => {
        const ref = buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/hero.png');
        const manager = managerFor([spriteAnimationEntry({ ref, priority: 'deferred' })]);

        const loaded = await manager.load(ref);

        expect(loaded.texture.colorSpace).toBe(THREE.SRGBColorSpace);
        expect(textureLoads.writes.map((write) => write.property)).toEqual(['colorSpace']);
    });

    it('configures the image a JSON atlas points at', async () => {
        const ref = buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/units/warrior.json');
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    frames: { idle: { x: 0, y: 0, w: 32, h: 32 } },
                    meta: { image: 'warrior.webp' },
                }),
            })),
        );
        const manager = managerFor([
            spriteAnimationEntry({ ref, priority: 'deferred', sampling: PIXEL_ART }),
        ]);

        const loaded = await manager.load(ref);

        expect(textureLoads.urls).toEqual(['resolved://tactics/sprites/units/warrior.webp']);
        expect(samplingFieldsOf(loaded.texture)).toMatchObject(PIXEL_ART_FIELDS);
        expect(loaded.frames).toEqual({ idle: { x: 0, y: 0, w: 32, h: 32 } });
    });

    it('rejects an atlas sheet with an invalid sampling before fetching its descriptor', async () => {
        const ref = buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/units/warrior.json');
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const manager = managerFor([
            {
                ref,
                kind: 'sprite-sheet',
                priority: 'deferred',
                metadata: { sampling: { anisotropy: 0 } },
            },
        ]);

        await expect(manager.load(ref)).rejects.toThrow(InvalidTextureSamplingError);
        expect(fetch).not.toHaveBeenCalled();
        expect(textureLoads.urls).toEqual([]);
    });
});
