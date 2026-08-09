/**
 * renderer/assets/spriteAtlas.test.ts
 *
 * Holds the fail-soft contract of the atlas reader, and the UV orientation.
 *
 * **The orientation cases are the load-bearing ones.** A reader that flipped `v`
 * still produces the right frame count, the right names and the right pixel
 * rects — it just draws every sprite upside down, which is only visible to a
 * case that names the numbers. So two cases spell out all four pairs, and a
 * third asserts the sign of the relationship (a frame lower down the IMAGE gets
 * a SMALLER `v`) so that a rewrite cannot satisfy the numbers by coincidence.
 */

import { describe, expect, it } from 'vitest';
import type { Texture } from 'three';

import type { LoadedSpriteSheetAsset } from './AssetManager.js';
import { parseSpriteAtlas } from './spriteAtlas.js';

/** A texture double carrying only what the reader reads: its decoded dimensions. */
function textureOf(width: number, height: number): Texture {
    return { image: { width, height } } as unknown as Texture;
}

function assetOf(frames: unknown, width = 64, height = 32): LoadedSpriteSheetAsset {
    return { texture: textureOf(width, height), frames } as LoadedSpriteSheetAsset;
}

describe('parseSpriteAtlas refuses, softly, anything it cannot measure', () => {
    it.each([
        ['no frames at all — a bare image sprite sheet', undefined],
        ['a frames value that is not an object', 'idle'],
        ['a frames value that is an array', []],
    ])('returns null for %s', (_label, frames) => {
        expect(parseSpriteAtlas(assetOf(frames))).toBeNull();
    });

    it.each([
        ['no image', {}],
        // three's own default: `new Texture()` starts with `image === null`,
        // so this is the shape a not-yet-decoded texture really has.
        ['a null image', { image: null }],
        ['a non-object image', { image: 'warrior.webp' }],
        ['an image with no dimensions', { image: {} }],
        ['a zero-width image', { image: { width: 0, height: 32 } }],
        ['a non-numeric height', { image: { width: 64, height: '32' } }],
    ])('returns null, and throws nothing, for a texture with %s', (_label, texture) => {
        // Cast through `unknown`: these are exactly the shapes the declared
        // `Texture` promises cannot arrive, and the point of the case is that
        // the reader survives them anyway.
        const asset = {
            texture,
            frames: { idle: { x: 0, y: 0, w: 32, h: 32 } },
        } as unknown as LoadedSpriteSheetAsset;

        expect(() => parseSpriteAtlas(asset)).not.toThrow();
        expect(parseSpriteAtlas(asset)).toBeNull();
    });

    it('returns an empty atlas rather than null when every frame is refused', () => {
        const atlas = parseSpriteAtlas(assetOf({ idle: { rotated: true } }));

        // A different answer from `null`: the sheet IS an atlas, and the
        // warnings say why nothing came out of it.
        expect(atlas?.frames).toEqual([]);
        expect(atlas?.warnings).toHaveLength(1);
        expect(atlas?.imageWidth).toBe(64);
        expect(atlas?.imageHeight).toBe(32);
    });
});

describe('parseSpriteAtlas refuses per frame and keeps the siblings', () => {
    it.each([
        ['rotated', { rotated: true, x: 0, y: 0, w: 8, h: 8 }],
        ['trimmed', { trimmed: true, x: 0, y: 0, w: 8, h: 8 }],
    ])('refuses a frame declaring %s: true rather than guessing', (flag, broken) => {
        const atlas = parseSpriteAtlas(assetOf({ good: { x: 0, y: 0, w: 8, h: 8 }, bad: broken }));

        expect(atlas?.frames.map((frame) => frame.name)).toEqual(['good']);
        expect(atlas?.warnings).toHaveLength(1);
        expect(atlas?.warnings[0]).toContain(flag);
        expect(atlas?.warnings[0]).toContain('bad');
    });

    it.each([
        ['rotated', { rotated: false, x: 0, y: 0, w: 8, h: 8 }],
        ['trimmed', { trimmed: false, x: 0, y: 0, w: 8, h: 8 }],
    ])(
        'accepts a frame declaring %s: false — the flag, not the key, is the refusal',
        (_flag, ok) => {
            const atlas = parseSpriteAtlas(assetOf({ plain: ok }));

            expect(atlas?.frames.map((frame) => frame.name)).toEqual(['plain']);
            expect(atlas?.warnings).toEqual([]);
        },
    );

    it.each([
        ['is not an object', 4],
        ['carries no rect', { rotated: false }],
        ['carries a non-numeric rect', { x: '0', y: 0, w: 8, h: 8 }],
        ['carries a zero-width rect', { x: 0, y: 0, w: 0, h: 8 }],
        ['carries a negative origin', { x: -1, y: 0, w: 8, h: 8 }],
        ['reaches past the image width', { x: 60, y: 0, w: 8, h: 8 }],
        ['reaches past the image height', { x: 0, y: 28, w: 8, h: 8 }],
    ])('refuses a frame that %s, with one warning', (_label, broken) => {
        const atlas = parseSpriteAtlas(assetOf({ good: { x: 0, y: 0, w: 8, h: 8 }, bad: broken }));

        expect(atlas?.frames.map((frame) => frame.name)).toEqual(['good']);
        expect(atlas?.warnings).toHaveLength(1);
        expect(atlas?.warnings[0]).toContain('bad');
    });

    it('accepts a rect that exactly fills the image', () => {
        const atlas = parseSpriteAtlas(assetOf({ whole: { x: 0, y: 0, w: 64, h: 32 } }));

        expect(atlas?.warnings).toEqual([]);
        expect(atlas?.frames[0]?.uv).toEqual([
            [0, 1],
            [1, 1],
            [0, 0],
            [1, 0],
        ]);
    });

    it('reads the rect out of a nested `frame` object as readily as a flat one', () => {
        const atlas = parseSpriteAtlas(
            assetOf({
                flat: { x: 0, y: 0, w: 32, h: 32 },
                nested: { frame: { x: 0, y: 0, w: 32, h: 32 }, rotated: false, trimmed: false },
            }),
        );

        expect(atlas?.warnings).toEqual([]);
        expect(atlas?.frames[0]?.uv).toEqual(atlas?.frames[1]?.uv);
    });
});

describe('parseSpriteAtlas writes UVs for a flipY texture', () => {
    it('maps the top-left cell of a 64x32 sheet to the four pairs, in plane order', () => {
        // Deliberately NOT square: a reader that reported `w` as the height
        // would be indistinguishable on a square cell.
        const atlas = parseSpriteAtlas(assetOf({ idle: { x: 0, y: 0, w: 32, h: 16 } }));

        expect(atlas?.frames[0]).toEqual({
            name: 'idle',
            x: 0,
            y: 0,
            width: 32,
            height: 16,
            // PlaneGeometry's own uv order, measured: top-left, top-right,
            // bottom-left, bottom-right, with v = 1 at the TOP.
            uv: [
                [0, 1],
                [0.5, 1],
                [0, 0.5],
                [0.5, 0.5],
            ],
        });
    });

    it('maps an inset cell to its own four pairs', () => {
        const atlas = parseSpriteAtlas(assetOf({ hit: { x: 32, y: 16, w: 16, h: 8 } }));

        expect(atlas?.frames[0]?.uv).toEqual([
            [0.5, 0.5],
            [0.75, 0.5],
            [0.5, 0.25],
            [0.75, 0.25],
        ]);
    });

    it('gives a frame further down the IMAGE a smaller v than one above it', () => {
        const atlas = parseSpriteAtlas(
            assetOf({ top: { x: 0, y: 0, w: 8, h: 8 }, below: { x: 0, y: 16, w: 8, h: 8 } }),
        );
        const topV = atlas?.frames[0]?.uv[0][1] ?? 0;
        const belowV = atlas?.frames[1]?.uv[0][1] ?? 0;

        // The whole point of `flipY: true`: v runs UP the image, so the reader
        // subtracts from 1. A reader that wrote `y / imageHeight` reverses this.
        expect(belowV).toBeLessThan(topV);
    });
});

describe('parseSpriteAtlas leaves the asset it read alone', () => {
    it('mutates neither the frames record nor the texture, and keeps declaration order', () => {
        const frames = {
            walk: { x: 0, y: 0, w: 8, h: 8 },
            attack: { x: 8, y: 0, w: 8, h: 8 },
            idle: { x: 16, y: 0, w: 8, h: 8 },
        };
        const before = structuredClone(frames);
        const asset = assetOf(frames);

        const atlas = parseSpriteAtlas(asset);

        expect(frames).toEqual(before);
        // Declaration order, not sorted: an atlas tool writes frames in the
        // order the clip plays them, and lexicographic order would put
        // `run_10` before `run_2`.
        expect(atlas?.frames.map((frame) => frame.name)).toEqual(['walk', 'attack', 'idle']);
    });
});
