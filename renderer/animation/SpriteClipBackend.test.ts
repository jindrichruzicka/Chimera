/**
 * renderer/animation/SpriteClipBackend.test.ts
 *
 * The sprite half of the `ClipBackend` seam: the same contract suite the mesh
 * backend runs, plus the rules that only exist because a sprite writes into
 * geometry it does not own and samples a texture the `AssetManager` owns.
 *
 * The atlas is hand-authored rather than parsed, so the UV constants below are
 * this file's own arithmetic and not a re-run of `parseSpriteAtlas`.
 */

import { describe, expect, it, vi } from 'vitest';
import {
    BufferAttribute,
    BufferGeometry,
    GLBufferAttribute,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Texture,
} from 'three';

import type { SpriteAtlas } from '../assets/spriteAtlas.js';

import type { ClipBackend, ClipPlayOptions, ClipPlayback } from './ClipBackend.js';
import { supportsBlending } from './ClipBackend.js';
import { SpriteClipBackend } from './SpriteClipBackend.js';
import { describeClipBackend } from './__test-support__/clipBackendContract.js';

/**
 * A two-cell atlas on a 64x64 image, with the cells on DIFFERENT rows.
 *
 * The `v` axis runs UP the image because the sheet is decoded through a
 * `Texture` whose `flipY` defaults to `true`, so `v = 1` samples the image's TOP
 * row while an atlas rect's `y` is measured DOWN from it:
 *
 *     u0 = x / 64                 u1 = (x + w) / 64
 *     vTop = 1 - y / 64           vBottom = 1 - (y + h) / 64
 *
 * Cell 0 sits at the top (`y = 0`, `vTop = 1`, `vBottom = 0.75`) and cell 1 at
 * the bottom (`y = 48`, `vTop = 0.25`, `vBottom = 0`). Two rows rather than two
 * columns for one reason: a cell spanning the full image height would have
 * `vTop = 1` and `vBottom = 0` and a global vertical flip would write the same
 * four pairs back.
 */
const ATLAS: SpriteAtlas = {
    imageWidth: 64,
    imageHeight: 64,
    frames: [
        {
            name: 'walk_0',
            x: 0,
            y: 0,
            width: 32,
            height: 16,
            uv: [
                [0, 1],
                [0.5, 1],
                [0, 0.75],
                [0.5, 0.75],
            ],
        },
        {
            name: 'walk_1',
            x: 16,
            y: 48,
            width: 32,
            height: 16,
            uv: [
                [0.25, 0.25],
                [0.75, 0.25],
                [0.25, 0],
                [0.75, 0],
            ],
        },
    ],
    warnings: [],
};

/** `PlaneGeometry`'s own vertex order, which the atlas UVs are written in. */
const TOP_LEFT = 0;
const TOP_RIGHT = 1;
const BOTTOM_LEFT = 2;
const BOTTOM_RIGHT = 3;

/**
 * A geometry's `uv` as the concrete `BufferAttribute` these cases allocate.
 * `getAttribute` is typed as a union with `InterleavedBufferAttribute`, which
 * carries no `version`, and every geometry built here is a plain quad.
 */
function uvAttributeOf(geometry: BufferGeometry): BufferAttribute {
    return geometry.getAttribute('uv') as BufferAttribute;
}

/** The four `uv` pairs a geometry currently holds, in vertex order. */
function readUv(geometry: BufferGeometry): readonly (readonly [number, number])[] {
    const uv = geometry.getAttribute('uv');
    return [TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT].map(
        (vertex) => [uv.getX(vertex), uv.getY(vertex)] as const,
    );
}

/** A backend over {@link ATLAS} plus the geometry the TEST allocates and owns. */
function makeRig(clips?: Record<string, { frames: readonly number[]; fps: number }>): {
    readonly geometry: PlaneGeometry;
    readonly backend: SpriteClipBackend;
} {
    const geometry = new PlaneGeometry(1, 1);
    const backend = new SpriteClipBackend({
        atlas: ATLAS,
        geometry,
        clips: clips ?? {
            walk: { frames: [0, 1], fps: 4 },
            blink: { frames: [0, 1, 0, 1, 0, 1, 0], fps: 14 },
        },
    });
    return { geometry, backend };
}

/** `play`, refusing `null` so a case never asserts against an optional handle. */
function play(backend: ClipBackend, clipName: string, options?: ClipPlayOptions): ClipPlayback {
    const playback = backend.play(clipName, options);
    if (playback === null) {
        throw new Error(`clip '${clipName}' is not playable`);
    }
    return playback;
}

describeClipBackend('SpriteClipBackend', () => {
    const geometry = new PlaneGeometry(1, 1);
    return {
        backend: new SpriteClipBackend({
            atlas: ATLAS,
            geometry,
            clips: { walk: { frames: [0, 1], fps: 4 } },
        }),
        clipName: 'walk',
        durationSeconds: 0.5,
        blends: false,
        release: () => {
            // The geometry is the FIXTURE's allocation, not the backend's.
            geometry.dispose();
        },
    };
});

describe('SpriteClipBackend', () => {
    it('is a ClipBackend that does not blend', () => {
        const { geometry, backend } = makeRig();

        const asBackend: ClipBackend = backend;
        expect(supportsBlending(asBackend)).toBe(false);

        backend.dispose();
        geometry.dispose();
    });

    describe('durations', () => {
        it('derives a duration of frames over fps, exactly', () => {
            const { geometry, backend } = makeRig();

            expect(backend.getDurationSeconds('blink')).toBe(0.5);
            expect(backend.getDurationSeconds('walk')).toBe(0.5);
            expect(backend.getDurationSeconds('no-such-clip')).toBeNull();

            backend.dispose();
            geometry.dispose();
        });

        it('refuses a clip whose run is empty, out of range, or paced by an unusable fps', () => {
            const { geometry, backend } = makeRig({
                empty: { frames: [], fps: 12 },
                outOfRange: { frames: [0, 2], fps: 12 },
                negativeIndex: { frames: [-1], fps: 12 },
                zeroFps: { frames: [0], fps: 0 },
                nonFiniteFps: { frames: [0], fps: Number.POSITIVE_INFINITY },
                fine: { frames: [1], fps: 12 },
            });

            for (const clipName of [
                'empty',
                'outOfRange',
                'negativeIndex',
                'zeroFps',
                'nonFiniteFps',
            ]) {
                expect(backend.getDurationSeconds(clipName), clipName).toBeNull();
                expect(backend.play(clipName), clipName).toBeNull();
            }
            // The positive control: the same constructor kept the usable clip.
            expect(backend.getDurationSeconds('fine')).toBeCloseTo(1 / 12, 15);

            backend.dispose();
            geometry.dispose();
        });
    });

    describe('the uv pairs it writes', () => {
        it('writes cell 0 on play and cell 1 when the frame changes, both pinned', () => {
            const { geometry, backend } = makeRig();

            const playback = play(backend, 'walk', { loop: 'loop' });
            expect(readUv(geometry)).toEqual([
                [0, 1],
                [0.5, 1],
                [0, 0.75],
                [0.5, 0.75],
            ]);

            // 0.3 s into a 0.5 s two-frame run is phase 0.6, which is cell 1.
            backend.advance(0.3);
            expect(playback.sample().phase).toBeCloseTo(0.6, 15);
            expect(readUv(geometry)).toEqual([
                [0.25, 0.25],
                [0.75, 0.25],
                [0.25, 0],
                [0.75, 0],
            ]);

            backend.dispose();
            geometry.dispose();
        });

        it('leaves the last cell on the quad when a playback is held, and when it is stopped', () => {
            const cell1 = ATLAS.frames[1]?.uv;
            const { geometry, backend } = makeRig();
            const playback = play(backend, 'walk', { loop: 'loop' });
            backend.advance(0.3);
            expect(readUv(geometry)).toEqual(cell1);

            playback.hold();
            backend.advance(0.3);

            // Both terminal verbs leave the same thing on screen here, and that
            // is the shape of the seam rather than an oversight: this backend
            // writes `uv` into a geometry it does not own, so it has nothing to
            // hand back. The mesh backend is where the two differ.
            expect(readUv(geometry)).toEqual(cell1);
            playback.stop();
            backend.advance(0.3);
            expect(readUv(geometry)).toEqual(cell1);

            backend.dispose();
            geometry.dispose();
        });

        it('writes nothing while the frame index is unchanged', () => {
            const { geometry, backend } = makeRig();
            play(backend, 'walk', { loop: 'loop' });
            const uv = geometry.getAttribute('uv');
            const setXY = vi.spyOn(uv, 'setXY');

            // Two advances inside cell 0 (phase 0.2 then 0.4).
            backend.advance(0.1);
            backend.advance(0.1);
            expect(setXY).not.toHaveBeenCalled();

            // And the control: crossing into cell 1 writes all four pairs once.
            backend.advance(0.1);
            expect(setXY).toHaveBeenCalledTimes(4);

            backend.dispose();
            geometry.dispose();
        });

        it('flags the attribute for upload once per frame it writes', () => {
            const { geometry, backend } = makeRig();
            const uv = uvAttributeOf(geometry);
            // `needsUpdate` is set-only on a `BufferAttribute` — reading it gives
            // `undefined` — and its setter bumps `version`, which is the readable
            // half. Without the bump a written cell never reaches the GPU.
            const versionBefore = uv.version;

            play(backend, 'walk', { loop: 'loop' });
            expect(uv.version).toBe(versionBefore + 1);

            // Still inside cell 0: no write, so no upload either.
            backend.advance(0.1);
            expect(uv.version).toBe(versionBefore + 1);

            backend.advance(0.2);
            expect(uv.version).toBe(versionBefore + 2);

            backend.dispose();
            geometry.dispose();
        });

        it('never indexes past the last frame, at phase 1 and at every phase below it', () => {
            const cell0 = ATLAS.frames[0]?.uv;
            const cell1 = ATLAS.frames[1]?.uv;
            const { geometry, backend } = makeRig({
                blink: { frames: [0, 1, 0, 1, 0, 1, 0], fps: 14 },
            });
            const playback = play(backend, 'blink', { loop: 'once' });

            // Swept rather than sampled at the boundary alone: `floor(phase x 7)`
            // is 7 at phase 1 and at nothing below it, so a sweep that never
            // reached 1 could not see the off-by-one, and a sweep that only
            // touched 1 could not see a rounding error anywhere else.
            for (let step = 0; step < 40; step += 1) {
                backend.advance(0.5 / 13);
                const written = readUv(geometry);
                expect(written, `step ${step}`).not.toEqual([]);
                expect([cell0, cell1], `step ${step}`).toContainEqual(written);
            }

            // The last entry of the run is cell 0, so reading one past the end
            // would leave cell 1 on the quad or throw.
            expect(playback.sample().phase).toBe(1);
            expect(readUv(geometry)).toEqual(cell0);

            backend.dispose();
            geometry.dispose();
        });

        it('shows the last entry of a run reached in a single advance from the start', () => {
            const cell1 = ATLAS.frames[1]?.uv;
            // The run's last entry is the ONLY one that shows cell 1, so a jump
            // straight from phase 0 to phase 1 is the one input where
            // `floor(phase x 7)` reaching 7 is visible: stepping there would have
            // shown cell 1 on the way and hidden the miss.
            const { geometry, backend } = makeRig({
                blink: { frames: [0, 0, 0, 0, 0, 0, 1], fps: 14 },
            });
            const playback = play(backend, 'blink', { loop: 'once' });

            backend.advance(10);

            expect(playback.sample().phase).toBe(1);
            expect(readUv(geometry)).toEqual(cell1);

            backend.dispose();
            geometry.dispose();
        });

        it('leaves a quad too small to hold four uv pairs untouched', () => {
            const geometry = new BufferGeometry();
            // Two vertices: a `setXY` at index 2 or 3 would write past the end of
            // the typed array, which is a silent no-op — so the guard has to
            // refuse the attribute rather than half-write it and flag an upload.
            const uv = new BufferAttribute(new Float32Array([0, 0, 1, 0]), 2);
            geometry.setAttribute('uv', uv);
            const backend = new SpriteClipBackend({
                atlas: ATLAS,
                geometry,
                clips: { walk: { frames: [0, 1], fps: 4 } },
            });

            play(backend, 'walk', { loop: 'loop' });
            backend.advance(0.3);

            expect(uv.version).toBe(0);
            expect(Array.from(uv.array)).toEqual([0, 0, 1, 0]);

            backend.dispose();
            geometry.dispose();
        });

        it('leaves a GPU-resident uv attribute alone, having no CPU-side setter to use', () => {
            const geometry = new BufferGeometry();
            // `BufferGeometry.attributes` may hold a `GLBufferAttribute`, whose
            // data lives on the GPU and which carries no `setXY` at all — a
            // count check alone would sail past it and throw mid-frame. Planted
            // through a cast because `BufferGeometry`'s DEFAULT attribute
            // parameter is the normal-buffer one — the GPU-resident shape is
            // reachable only through the `GLBufferAttributes` instantiation, and
            // a geometry typed that way is not the one this backend takes.
            (geometry.attributes as Record<string, unknown>)['uv'] = new GLBufferAttribute(
                {},
                5126,
                2,
                4,
                4,
            );
            const backend = new SpriteClipBackend({
                atlas: ATLAS,
                geometry,
                clips: { walk: { frames: [0, 1], fps: 4 } },
            });

            const playback = play(backend, 'walk', { loop: 'loop' });
            expect(() => {
                backend.advance(0.3);
            }).not.toThrow();
            expect(playback.sample().phase).toBeCloseTo(0.6, 15);

            backend.dispose();
            geometry.dispose();
        });

        it('leaves a geometry with no usable uv attribute alone instead of throwing', () => {
            const geometry = new BufferGeometry();
            const backend = new SpriteClipBackend({
                atlas: ATLAS,
                geometry,
                clips: { walk: { frames: [0, 1], fps: 4 } },
            });

            const playback = play(backend, 'walk', { loop: 'loop' });
            expect(() => {
                backend.advance(0.3);
            }).not.toThrow();
            expect(playback.sample().phase).toBeCloseTo(0.6, 15);

            backend.dispose();
            geometry.dispose();
        });
    });

    describe('Rule SPRITE-NO-SHARED-MUTATION', () => {
        it('touches neither the shared texture nor a sibling sprite across a full cycle', () => {
            const writes: string[] = [];
            const disposals: string[] = [];
            const texture = new Texture();
            const shared = new Proxy(texture, {
                set(target, property, value: unknown, receiver: unknown) {
                    writes.push(String(property));
                    return Reflect.set(target, property, value, receiver);
                },
                get(target, property, receiver: unknown) {
                    if (property === 'dispose') {
                        return () => {
                            disposals.push('dispose');
                        };
                    }
                    return Reflect.get(target, property, receiver) as unknown;
                },
            });
            // One material, one texture, two sprites: the texture and the atlas
            // are the shared state, and each sprite's per-frame state is its own
            // geometry. The sibling is the control.
            const material = new MeshBasicMaterial({ map: shared });
            const driven = new PlaneGeometry(1, 1);
            const sibling = new PlaneGeometry(1, 1);
            const drivenSprite = new Mesh(driven, material);
            const siblingSprite = new Mesh(sibling, material);
            const siblingUvBefore = readUv(sibling);
            const backend = new SpriteClipBackend({
                atlas: ATLAS,
                geometry: driven,
                clips: { walk: { frames: [0, 1], fps: 4 } },
            });

            play(backend, 'walk', { loop: 'loop' });
            backend.advance(0.3);
            backend.advance(0.3);
            backend.dispose();

            expect(writes).toEqual([]);
            expect(disposals).toEqual([]);
            expect(readUv(sibling)).toEqual(siblingUvBefore);
            // The positive control: the driven sprite really did move, so the
            // zero counts above are not the counts of a backend that did nothing.
            expect(readUv(driven)).not.toEqual(siblingUvBefore);
            expect(drivenSprite.material).toBe(siblingSprite.material);

            driven.dispose();
            sibling.dispose();
            material.dispose();
        });

        it('releases only what it allocated: the injected geometry survives dispose', () => {
            const { geometry, backend } = makeRig();
            const disposeGeometry = vi.spyOn(geometry, 'dispose');
            play(backend, 'walk', { loop: 'loop' });
            backend.advance(0.3);
            const uvAfterPlay = readUv(geometry);

            backend.dispose();
            backend.dispose();

            expect(disposeGeometry).not.toHaveBeenCalled();
            expect(readUv(geometry)).toEqual(uvAfterPlay);

            geometry.dispose();
        });
    });

    describe('the loop mode a clip declares', () => {
        it('plays a clip at its own declared mode when the caller names none', () => {
            const geometry = new PlaneGeometry(1, 1);
            const backend = new SpriteClipBackend({
                atlas: ATLAS,
                geometry,
                clips: { walk: { frames: [0, 1], fps: 4, loop: 'loop' } },
            });

            const playback = backend.play('walk');
            if (playback === null) {
                throw new Error('play returned null for a clip the backend has');
            }
            backend.advance(0.75);

            // A backend defaulting to 'once' regardless would have clamped this
            // at phase 1 and latched `ended`.
            expect(playback.sample()).toEqual({ phase: 0.5, cycle: 1, ended: false });

            backend.dispose();
            geometry.dispose();
        });
    });

    describe('one sprite, one playback', () => {
        it('releases the live playback when another clip starts on the same geometry', () => {
            const { geometry, backend } = makeRig();

            const first = play(backend, 'walk', { loop: 'loop' });
            backend.advance(0.2);
            const second = play(backend, 'blink', { loop: 'loop' });

            // One quad can show one frame, so the outgoing playback is terminal
            // and frozen where it was.
            expect(first.sample()).toEqual({ phase: 0.4, cycle: 0, ended: true });
            expect(second.sample()).toEqual({ phase: 0, cycle: 0, ended: false });
            backend.advance(0.1);
            expect(first.sample().phase).toBe(0.4);
            expect(second.sample().phase).toBeCloseTo(0.2, 15);

            backend.dispose();
            geometry.dispose();
        });
    });
});
