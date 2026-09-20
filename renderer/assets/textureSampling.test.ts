/**
 * renderer/assets/textureSampling.test.ts
 *
 * Unit tests for `applyTextureSampling`: the renderer-side half of per-entry
 * texture sampling (§4.10), which turns the engine-owned names a manifest entry
 * declares into `three` values on a texture.
 *
 * Runs against the real `three` constants and a real `Texture`, so a name mapped
 * to the wrong constant fails here rather than on screen.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { TextureSampling } from '@chimera-engine/simulation/foundation/texture-sampling.js';

import { applyTextureSampling } from './textureSampling';

/** The fields sampling may write, read back off a texture. */
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

function applied(sampling: TextureSampling): THREE.Texture {
    const texture = new THREE.Texture();
    applyTextureSampling(texture, sampling, THREE);
    return texture;
}

describe('applyTextureSampling', () => {
    it.each([
        ['srgb', THREE.SRGBColorSpace],
        ['srgb-linear', THREE.LinearSRGBColorSpace],
        ['none', THREE.NoColorSpace],
    ] as const)('maps colorSpace %s', (colorSpace, expected) => {
        // Start from a different color space, so writing `none` — three's own
        // default — is observable too.
        const texture = new THREE.Texture();
        texture.colorSpace =
            expected === THREE.SRGBColorSpace ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;

        applyTextureSampling(texture, { colorSpace }, THREE);

        expect(texture.colorSpace).toBe(expected);
    });

    it.each([
        ['nearest', THREE.NearestFilter],
        ['linear', THREE.LinearFilter],
    ] as const)('maps magFilter %s', (magFilter, expected) => {
        // The other filter first, so writing three's own default is observable.
        const texture = new THREE.Texture();
        texture.magFilter = magFilter === 'linear' ? THREE.NearestFilter : THREE.LinearFilter;

        applyTextureSampling(texture, { magFilter }, THREE);

        expect(texture.magFilter).toBe(expected);
    });

    it.each([
        ['nearest', THREE.NearestFilter],
        ['linear', THREE.LinearFilter],
        ['nearest-mipmap-nearest', THREE.NearestMipmapNearestFilter],
        ['nearest-mipmap-linear', THREE.NearestMipmapLinearFilter],
        ['linear-mipmap-nearest', THREE.LinearMipmapNearestFilter],
        ['linear-mipmap-linear', THREE.LinearMipmapLinearFilter],
    ] as const)('maps minFilter %s', (minFilter, expected) => {
        const texture = new THREE.Texture();
        texture.minFilter =
            minFilter === 'linear-mipmap-linear'
                ? THREE.NearestFilter
                : THREE.LinearMipmapLinearFilter;

        applyTextureSampling(texture, { minFilter }, THREE);

        expect(texture.minFilter).toBe(expected);
    });

    it.each([
        ['clamp', THREE.ClampToEdgeWrapping],
        ['repeat', THREE.RepeatWrapping],
        ['mirrored-repeat', THREE.MirroredRepeatWrapping],
    ] as const)('maps wrap mode %s on each axis independently', (wrap, expected) => {
        const other = wrap === 'clamp' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;

        const onS = new THREE.Texture();
        onS.wrapS = other;
        onS.wrapT = other;
        applyTextureSampling(onS, { wrapS: wrap }, THREE);
        expect([onS.wrapS, onS.wrapT]).toEqual([expected, other]);

        const onT = new THREE.Texture();
        onT.wrapS = other;
        onT.wrapT = other;
        applyTextureSampling(onT, { wrapT: wrap }, THREE);
        expect([onT.wrapS, onT.wrapT]).toEqual([other, expected]);
    });

    it.each([true, false])('writes flipY %s', (flipY) => {
        const texture = new THREE.Texture();
        texture.flipY = !flipY;

        applyTextureSampling(texture, { flipY }, THREE);

        expect(texture.flipY).toBe(flipY);
    });

    it.each([true, false])('writes generateMipmaps %s', (generateMipmaps) => {
        const texture = new THREE.Texture();
        texture.generateMipmaps = !generateMipmaps;

        applyTextureSampling(texture, { generateMipmaps }, THREE);

        expect(texture.generateMipmaps).toBe(generateMipmaps);
    });

    it('writes anisotropy as declared', () => {
        expect(applied({ anisotropy: 8 }).anisotropy).toBe(8);
    });

    it('leaves every option the sampling does not declare as the loader produced it', () => {
        const untouched = samplingFieldsOf(new THREE.Texture());

        expect(samplingFieldsOf(applied({}))).toEqual(untouched);
        // One declared option moves that field and no other.
        expect(samplingFieldsOf(applied({ anisotropy: 8 }))).toEqual({
            ...untouched,
            anisotropy: 8,
        });
    });

    it('applies every option of one declaration together', () => {
        const texture = applied({
            colorSpace: 'srgb',
            magFilter: 'nearest',
            minFilter: 'nearest',
            wrapS: 'repeat',
            wrapT: 'mirrored-repeat',
            flipY: false,
            anisotropy: 4,
            generateMipmaps: false,
        });

        expect(samplingFieldsOf(texture)).toEqual({
            colorSpace: THREE.SRGBColorSpace,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter,
            wrapS: THREE.RepeatWrapping,
            wrapT: THREE.MirroredRepeatWrapping,
            flipY: false,
            anisotropy: 4,
            generateMipmaps: false,
        });
    });
});
