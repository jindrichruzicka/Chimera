/**
 * renderer/assets/textureSampling.ts
 *
 * The renderer-side half of per-entry texture sampling (§4.10): turns the
 * engine-owned names a manifest entry declares into `three` values on a texture.
 *
 * `three` arrives as an ARGUMENT, and this module's own imports are type-only.
 * It is reached statically from `AssetManager.ts`, which the always-mounted shell
 * layout graph includes, so a value import naming `three` here would put the
 * renderer core back in that chunk — see `loadTexture` in `AssetManager.ts`,
 * which hands over the namespace it has already imported dynamically.
 */

import type * as Three from 'three';
import type { Texture } from 'three';

import type { TextureSampling } from '@chimera-engine/simulation/foundation/texture-sampling.js';

/** The `three` constants the sampling names map onto. */
export type TextureSamplingConstants = Pick<
    typeof Three,
    | 'SRGBColorSpace'
    | 'LinearSRGBColorSpace'
    | 'NoColorSpace'
    | 'NearestFilter'
    | 'LinearFilter'
    | 'NearestMipmapNearestFilter'
    | 'NearestMipmapLinearFilter'
    | 'LinearMipmapNearestFilter'
    | 'LinearMipmapLinearFilter'
    | 'ClampToEdgeWrapping'
    | 'RepeatWrapping'
    | 'MirroredRepeatWrapping'
>;

/**
 * Writes each option `sampling` declares onto `texture`, and leaves every option
 * it does not declare as the loader produced it.
 *
 * Called by the loader on a texture nothing else has seen yet. It is not for a
 * texture a consumer already holds: that one is shared, and configuring it for
 * one consumer reconfigures it for all of them.
 *
 * `sampling` is expected to have been checked by `readTextureSampling`; the
 * `Record` lookups below are total over its vocabulary.
 */
export function applyTextureSampling(
    texture: Texture,
    sampling: TextureSampling,
    three: TextureSamplingConstants,
): void {
    if (sampling.colorSpace !== undefined) {
        texture.colorSpace = {
            srgb: three.SRGBColorSpace,
            'srgb-linear': three.LinearSRGBColorSpace,
            none: three.NoColorSpace,
        }[sampling.colorSpace];
    }
    if (sampling.magFilter !== undefined) {
        texture.magFilter = {
            nearest: three.NearestFilter,
            linear: three.LinearFilter,
        }[sampling.magFilter];
    }
    if (sampling.minFilter !== undefined) {
        texture.minFilter = {
            nearest: three.NearestFilter,
            linear: three.LinearFilter,
            'nearest-mipmap-nearest': three.NearestMipmapNearestFilter,
            'nearest-mipmap-linear': three.NearestMipmapLinearFilter,
            'linear-mipmap-nearest': three.LinearMipmapNearestFilter,
            'linear-mipmap-linear': three.LinearMipmapLinearFilter,
        }[sampling.minFilter];
    }

    const wrapModes = {
        clamp: three.ClampToEdgeWrapping,
        repeat: three.RepeatWrapping,
        'mirrored-repeat': three.MirroredRepeatWrapping,
    };
    if (sampling.wrapS !== undefined) {
        texture.wrapS = wrapModes[sampling.wrapS];
    }
    if (sampling.wrapT !== undefined) {
        texture.wrapT = wrapModes[sampling.wrapT];
    }

    if (sampling.flipY !== undefined) {
        texture.flipY = sampling.flipY;
    }
    if (sampling.anisotropy !== undefined) {
        texture.anisotropy = sampling.anisotropy;
    }
    if (sampling.generateMipmaps !== undefined) {
        texture.generateMipmaps = sampling.generateMipmaps;
    }
}
