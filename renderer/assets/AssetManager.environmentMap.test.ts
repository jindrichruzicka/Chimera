/**
 * renderer/assets/AssetManager.environmentMap.test.ts
 *
 * The `environment-map` loader (§4.10): an equirectangular HDRI resolved through
 * the manifest like any other asset, ready to light a PBR scene.
 *
 * **No decoder is doubled.** The manager's resolver hands the loader a `data:`
 * URL carrying bytes this file builds, so three's real `HDRLoader` decodes
 * them. That is what makes the colour-space and mapping assertions measurements
 * of the library rather than of a double — the whole reason this kind exists is
 * that an HDRI must arrive as linear radiance data, and a stub would have been
 * free to agree with us.
 *
 * Which loader ran is read off the ERROR each one gives for bytes it cannot
 * parse: the two messages name their own class, so routing is observable
 * without reaching inside the module. That is all the `.exr` arm measures —
 * no fixture here decodes one, so what an OpenEXR file resolves TO is
 * unpinned.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
    buildAssetRef,
    type EnvironmentMapAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManifestEntry } from '@chimera-engine/simulation/content/AssetManifest.js';
import { InvalidTextureSamplingError } from '@chimera-engine/simulation/foundation/texture-sampling.js';

import { DefaultAssetManager, UnsupportedEnvironmentMapFormatError } from './AssetManager';

/**
 * three's `FileLoader` dispatches a `ProgressEvent`, which the browser has and
 * the vitest node environment does not. Only the test needs it: the renderer
 * runs in Chromium.
 */
class StubProgressEvent {
    constructor(
        public readonly type: string,
        public readonly init?: unknown,
    ) {}
}
(globalThis as Record<string, unknown>)['ProgressEvent'] ??= StubProgressEvent;

/**
 * A Radiance HDR image, flat (un-RLE'd) RGBE.
 *
 * `HDRLoader` reads a scanline as run-length encoded only when its first bytes
 * are `2, 2, <high byte with bit 7 clear>`; every pixel below starts at 60 or
 * above, so the flat path is taken and no encoder is needed here.
 */
function radianceHdr(width: number, height: number): Uint8Array {
    const header = new TextEncoder().encode(
        `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`,
    );
    const pixels = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
        pixels[pixel * 4] = 60 + pixel;
        pixels[pixel * 4 + 1] = 120;
        pixels[pixel * 4 + 2] = 200;
        pixels[pixel * 4 + 3] = 128;
    }
    const bytes = new Uint8Array(header.length + pixels.length);
    bytes.set(header, 0);
    bytes.set(pixels, header.length);
    return bytes;
}

function dataUrl(bytes: Uint8Array): string {
    return `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`;
}

const NOT_AN_IMAGE = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);

/**
 * A manager whose resolver answers with `url` whatever ref it is handed, so the
 * ref carries the FORMAT and the URL carries the BYTES. The loader picks its
 * decoder off the ref, which is the authored path; the resolver is free to serve
 * those bytes from anywhere.
 */
function managerFor(entry: AssetManifestEntry, url: string): DefaultAssetManager {
    return new DefaultAssetManager({ resolve: () => url }, undefined, {
        gameId: 'tactics',
        entries: [entry],
    });
}

function environmentEntry(
    relativePath: string,
    metadata?: unknown,
): {
    readonly ref: ReturnType<typeof buildAssetRef<EnvironmentMapAsset>>;
    readonly entry: AssetManifestEntry;
} {
    const ref = buildAssetRef<EnvironmentMapAsset>('tactics', relativePath);
    const base = { ref, kind: 'environment-map', priority: 'deferred' } as const;
    return {
        ref,
        entry: metadata === undefined ? base : { ...base, metadata },
    };
}

describe('the environment-map loader', () => {
    it('resolves a .hdr ref to a decoded texture mapped for equirectangular lookup', async () => {
        const { ref, entry } = environmentEntry('environment/sky.hdr');
        const manager = managerFor(entry, dataUrl(radianceHdr(4, 2)));

        const texture = (await manager.load(ref)) as THREE.DataTexture;

        // Equirectangular is what the kind means, and three's own default is
        // UVMapping — so an unset mapping would sample the HDRI as a flat decal
        // and light nothing.
        expect(texture.mapping).toBe(THREE.EquirectangularReflectionMapping);
        expect(texture.image.width).toBe(4);
        expect(texture.image.height).toBe(2);
    });

    it('publishes the radiance data as the loader produced it when the entry declares no sampling', async () => {
        const { ref, entry } = environmentEntry('environment/sky.hdr');
        const manager = managerFor(entry, dataUrl(radianceHdr(4, 2)));

        const texture = (await manager.load(ref)) as THREE.DataTexture;

        // The engine's texture default is sRGB, and applying it here would tell
        // the renderer to decode linear radiance a second time. `HDRLoader`
        // writes `srgb-linear` itself; this asserts the engine leaves it.
        expect(texture.colorSpace).toBe(THREE.LinearSRGBColorSpace);
        expect(texture.type).toBe(THREE.HalfFloatType);
    });

    it('applies the sampling the entry declares', async () => {
        const { ref, entry } = environmentEntry('environment/sky.hdr', {
            sampling: { minFilter: 'nearest', wrapS: 'repeat' },
        });
        const manager = managerFor(entry, dataUrl(radianceHdr(4, 2)));

        const texture = (await manager.load(ref)) as THREE.DataTexture;

        // Both differ from what `HDRLoader` leaves behind (LinearFilter,
        // ClampToEdgeWrapping), so writing the loader's own value is not a pass.
        expect(texture.minFilter).toBe(THREE.NearestFilter);
        expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    });

    it('lets a declared colour space override the one the loader wrote', async () => {
        const { ref, entry } = environmentEntry('environment/sky.hdr', {
            sampling: { colorSpace: 'srgb' },
        });
        const manager = managerFor(entry, dataUrl(radianceHdr(4, 2)));

        const texture = (await manager.load(ref)) as THREE.DataTexture;

        expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    });

    it('hands a .exr ref to the OpenEXR decoder', async () => {
        const { ref, entry } = environmentEntry('environment/sky.exr');
        const manager = managerFor(entry, dataUrl(NOT_AN_IMAGE));

        // Bytes no loader can parse, so the rejection names whichever one ran.
        await expect(manager.load(ref)).rejects.toThrow(/THREE\.EXRLoader/u);
    });

    it('rejects a malformed .hdr with the decoder that read it', async () => {
        const { ref, entry } = environmentEntry('environment/sky.hdr');
        const manager = managerFor(entry, dataUrl(NOT_AN_IMAGE));

        await expect(manager.load(ref)).rejects.toThrow(/THREE\.HDRLoader/u);
    });

    it('rejects when the bytes cannot be fetched', async () => {
        const { ref, entry } = environmentEntry('environment/sky.hdr');
        const manager = managerFor(
            entry,
            'chimera://renderer/game-assets/tactics/environment/sky.hdr',
        );

        const rejection: unknown = await manager.load(ref).then(
            () => null,
            (error: unknown) => error,
        );

        // A failed fetch surfaces as a `TypeError`, which every named error on
        // this path — the unknown kind, the refused extension, an invalid
        // sampling declaration, a decoder's own complaint — is not. So this
        // says "the bytes never arrived" rather than "something threw". A file
        // the protocol answers 404 for is a different rejection, three's own
        // `HttpError`, which nothing offline can produce a fixture for.
        expect(rejection).toBeInstanceOf(TypeError);
    });

    it('names the extension it will not load, rather than reaching for a decoder', async () => {
        const { ref, entry } = environmentEntry('environment/sky.png');
        const manager = managerFor(entry, dataUrl(radianceHdr(4, 2)));

        await expect(manager.load(ref)).rejects.toThrow(UnsupportedEnvironmentMapFormatError);
        // The message has to say which extension was refused and which are
        // loadable, or the game is left guessing at the manifest entry.
        await expect(manager.load(ref)).rejects.toThrow(/\.png/u);
        await expect(manager.load(ref)).rejects.toThrow(/\.hdr/u);
        await expect(manager.load(ref)).rejects.toThrow(/\.exr/u);
        // error.name is consumer-visible: the logging pipeline serialises it.
        await expect(manager.load(ref)).rejects.toHaveProperty(
            'name',
            'UnsupportedEnvironmentMapFormatError',
        );
    });

    it('rejects an invalid sampling declaration before it decodes anything', async () => {
        const { ref, entry } = environmentEntry('environment/sky.hdr', {
            sampling: { minFilter: 'trilinear' },
        });
        const manager = managerFor(entry, dataUrl(NOT_AN_IMAGE));

        await expect(manager.load(ref)).rejects.toThrow(InvalidTextureSamplingError);
    });
});
