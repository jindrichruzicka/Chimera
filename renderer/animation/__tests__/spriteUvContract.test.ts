/**
 * renderer/animation/__tests__/spriteUvContract.test.ts
 *
 * The sprite UV contract, as a guard behind the prose.
 *
 * `docs/core-components/animation-system.md` tells a shader author that a custom
 * sprite material reading `uv` animates for free, and that the four pairs arrive
 * in `PlaneGeometry`'s vertex order — top-left, top-right, bottom-left,
 * bottom-right. Once documented that is a claim the tree has to keep true, and it
 * rests on a chain of three facts held in three different modules, none of which
 * could be checked against the others until this file:
 *
 *  1. `PlaneGeometry`'s own vertex order — a `three` fact, recorded in
 *     `AnimatedSprite.tsx`'s header as a measurement, and pinned by this file.
 *  2. `parseSpriteAtlas` emitting a cell's four pairs in that same order.
 *  3. `SpriteClipBackend` writing them straight through, unrecomputed.
 *
 * Each module's own tests hold its end. What none of them holds is that the ends
 * MEET — `SpriteClipBackend.test.ts` names constants `TOP_LEFT = 0` and so on,
 * which asserts the correspondence by naming it rather than by measuring it, so
 * a `three` release that reordered plane vertices would leave every one of those
 * tests green and every sprite in every game drawing its cells mirrored.
 *
 * The same trap applies vertically, which is why the fixture here spans two rows
 * — see `loadedSheet`.
 */

import { PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import { parseSpriteAtlas } from '../../assets/spriteAtlas.js';
import type { LoadedSpriteSheetAsset } from '../../assets/AssetManager.js';
import { SpriteClipBackend } from '../SpriteClipBackend.js';

/**
 * The corner each quad vertex is, read off `position` rather than assumed.
 *
 * This is what makes the NAMES in this file mean something: `uv[0] === [0, 1]`
 * alone says nothing about which corner vertex 0 draws, and the whole contract
 * is stated in corner names.
 */
const CORNERS = [
    { name: 'top-left', index: 0, x: -0.5, y: 0.5 },
    { name: 'top-right', index: 1, x: 0.5, y: 0.5 },
    { name: 'bottom-left', index: 2, x: -0.5, y: -0.5 },
    { name: 'bottom-right', index: 3, x: 0.5, y: -0.5 },
] as const;

/**
 * A 64x32 sheet with cells on TWO rows.
 *
 * Two rows on purpose. Cells that SPAN the sheet's full height carry `vTop = 1`
 * and `vBottom = 0` — a fresh quad's own v column — and over a fixture like that
 * nothing here could observe a wrong `v` at all: a whole-sheet vertical mirror,
 * or a backend taking v from the quad and discarding the cell's, would both
 * pass. Both are mutants this file kills, and the v values it turns on are
 * pinned below.
 */
function loadedSheet(): LoadedSpriteSheetAsset {
    return {
        texture: { image: { width: 64, height: 32 }, flipY: true },
        frames: {
            run_0: { frame: { x: 0, y: 0, w: 16, h: 16 } },
            run_1: { frame: { x: 16, y: 16, w: 16, h: 16 } },
        },
    } as unknown as LoadedSpriteSheetAsset;
}

function uvPairs(geometry: PlaneGeometry): readonly (readonly [number, number])[] {
    const uv = geometry.getAttribute('uv');
    return CORNERS.map((corner) => [uv.getX(corner.index), uv.getY(corner.index)] as const);
}

describe('a sprite quad’s vertex order is what the contract names it', () => {
    it('puts each named corner at the index the contract uses for it', () => {
        // Measured off `position`, so the corner names are earned rather than
        // asserted. A `three` release that reordered plane vertices reds here.
        const geometry = new PlaneGeometry(1, 1);
        const position = geometry.getAttribute('position');

        for (const corner of CORNERS) {
            expect(position.getX(corner.index), corner.name).toBeCloseTo(corner.x, 6);
            expect(position.getY(corner.index), corner.name).toBeCloseTo(corner.y, 6);
        }

        geometry.dispose();
    });

    it('starts life with the whole-texture uv the atlas order is shaped around', () => {
        // The documented measurement: [0,1] [1,1] [0,0] [1,0]. This is why a
        // cell's pairs can be written straight through with no re-derivation.
        const geometry = new PlaneGeometry(1, 1);

        expect(uvPairs(geometry)).toEqual([
            [0, 1],
            [1, 1],
            [0, 0],
            [1, 0],
        ]);

        geometry.dispose();
    });

    it('carries exactly four vertices, which is what the backend requires', () => {
        const geometry = new PlaneGeometry(1, 1);

        expect(geometry.getAttribute('uv').count).toBe(4);

        geometry.dispose();
    });
});

describe('the atlas emits a cell in that same vertex order', () => {
    it('orders a cell’s four pairs top-left, top-right, bottom-left, bottom-right', () => {
        const atlas = parseSpriteAtlas(loadedSheet());
        const cell = atlas?.frames[0];

        expect(cell).toBeDefined();
        const [topLeft, topRight, bottomLeft, bottomRight] = cell!.uv;

        // The two top pairs share a v, the two bottom pairs share the other, and
        // the left pairs share a u — which is what "these are the four corners of
        // one rectangle, in this order" means when written as coordinates.
        expect(topLeft[1]).toBe(topRight[1]);
        expect(bottomLeft[1]).toBe(bottomRight[1]);
        expect(topLeft[0]).toBe(bottomLeft[0]);
        expect(topRight[0]).toBe(bottomRight[0]);

        // Both axes by VALUE, not by the names they were destructured into. The
        // horizontal half is the easy one; the vertical half is what a whole-sheet
        // mirror would break, and naming a pair `topLeft` asserts nothing about
        // which row it samples. Under the sheet's `flipY: true`, v runs UP the
        // image, so the top pairs carry the GREATER v.
        expect(topLeft[0]).toBeLessThan(topRight[0]);
        expect(topLeft[1]).toBeGreaterThan(bottomLeft[1]);
        expect(topRight[1]).toBeGreaterThan(bottomRight[1]);
    });

    it('cuts the lower row lower, so a v that ignored the cell would show', () => {
        const atlas = parseSpriteAtlas(loadedSheet());
        const lower = atlas?.frames[1];

        expect(lower).toBeDefined();
        expect(lower!.uv[0][1]).toBe(0.5);
        expect(lower!.uv[2][1]).toBe(0);
    });
});

describe('the backend writes those pairs straight through', () => {
    it('lands each atlas pair on the vertex of the same index, unrecomputed', () => {
        // The join: what `parseSpriteAtlas` measured is what a shader reading
        // `uv` samples, pair for pair, with nothing re-derived in between. A
        // backend that transposed, mirrored or recomputed the pairs reds here.
        const geometry = new PlaneGeometry(1, 1);
        const atlas = parseSpriteAtlas(loadedSheet());
        const backend = new SpriteClipBackend({
            atlas: atlas!,
            geometry,
            clips: { run: { frames: [0, 1], fps: 2 } },
        });

        backend.play('run');

        expect(uvPairs(geometry)).toEqual(atlas!.frames[0]!.uv);

        backend.dispose();
        geometry.dispose();
    });

    it('re-cuts the same four vertices when the clip moves to the next cell', () => {
        // The other half of what a shader may rely on: the attribute is REWRITTEN
        // in place, so a material holding this geometry needs no notification and
        // no second binding — the pairs it already samples simply change.
        const geometry = new PlaneGeometry(1, 1);
        const atlas = parseSpriteAtlas(loadedSheet());
        const backend = new SpriteClipBackend({
            atlas: atlas!,
            geometry,
            clips: { run: { frames: [0, 1], fps: 2 } },
        });
        const positionBefore = [...geometry.getAttribute('position').array];
        const normalBefore = [...geometry.getAttribute('normal').array];
        const indexBefore = [...(geometry.getIndex()?.array ?? [])];
        backend.play('run');

        const firstCell = uvPairs(geometry);
        backend.advance(0.6);

        expect(uvPairs(geometry)).toEqual(atlas!.frames[1]!.uv);
        expect(uvPairs(geometry)).not.toEqual(firstCell);
        expect(geometry.getAttribute('uv').count).toBe(4);

        // The rest of the quad is untouched, which is the other half of what the
        // contract lets a shader rely on: only `uv` moves.
        expect([...geometry.getAttribute('position').array]).toEqual(positionBefore);
        expect([...geometry.getAttribute('normal').array]).toEqual(normalBefore);
        expect([...(geometry.getIndex()?.array ?? [])]).toEqual(indexBefore);

        backend.dispose();
        geometry.dispose();
    });
});
