/**
 * renderer/animation/spriteClipSpecs.test.ts
 *
 * The authored-sheet → backend-spec bridge: what a sprite clip declaration has
 * to carry before `SpriteClipBackend` can play it, and what is dropped.
 */

import { describe, expect, it } from 'vitest';

import type { SpriteAnimationMetadata } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { toSpriteClipSpecs } from './spriteClipSpecs.js';

describe('toSpriteClipSpecs', () => {
    it('derives fps from the frame count and the authored duration', () => {
        const sheet: SpriteAnimationMetadata = {
            clips: { run: { frames: [0, 1, 2, 3], durationSeconds: 0.5 } },
        };

        const { specs, warnings } = toSpriteClipSpecs(sheet);

        // 4 frames across 0.5 s is 8 fps, and the backend's own
        // `frames.length / fps` must return the authored duration exactly.
        expect(specs['run']).toEqual({ frames: [0, 1, 2, 3], fps: 8, loop: 'once' });
        expect(warnings).toEqual([]);
    });

    it('round-trips the authored duration back through the backend’s own formula', () => {
        const sheet: SpriteAnimationMetadata = {
            clips: { idle: { frames: [4, 5, 6], durationSeconds: 1.2 } },
        };

        const spec = toSpriteClipSpecs(sheet).specs['idle'];

        expect(spec).toBeDefined();
        // This is the property the whole bridge exists for: a sheet's marks are
        // compiled against `durationSeconds`, so a backend that reported a
        // different length would fire every mark at the wrong phase.
        expect(spec!.frames.length / spec!.fps).toBeCloseTo(1.2, 10);
    });

    it('carries the authored loop mode through, defaulting to once', () => {
        const sheet: SpriteAnimationMetadata = {
            clips: {
                run: { frames: [0], durationSeconds: 1, loop: 'loop' },
                hit: { frames: [1], durationSeconds: 1 },
            },
        };

        const { specs } = toSpriteClipSpecs(sheet);

        expect(specs['run']?.loop).toBe('loop');
        expect(specs['hit']?.loop).toBe('once');
    });

    it('drops a clip with no authored duration, naming it', () => {
        const sheet: SpriteAnimationMetadata = {
            clips: { run: { frames: [0, 1] } },
        };

        const { specs, warnings } = toSpriteClipSpecs(sheet);

        expect(specs['run']).toBeUndefined();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('run');
        expect(warnings[0]).toContain('durationSeconds');
    });

    it.each([
        ['zero', 0],
        ['negative', -1],
        ['infinite', Number.POSITIVE_INFINITY],
        ['NaN', Number.NaN],
    ])('drops a clip whose duration is %s', (_label, durationSeconds) => {
        const sheet = { clips: { run: { frames: [0, 1], durationSeconds } } };

        const { specs, warnings } = toSpriteClipSpecs(sheet);

        expect(specs['run']).toBeUndefined();
        expect(warnings).toHaveLength(1);
    });

    it('drops a clip whose frame run carries a non-number, the way the type promises', () => {
        // The sheet arrives through the `unknown` metadata slot, so `frames` is
        // only a `readonly number[]` by declaration. The predicate that narrows
        // it claims element types, so it has to check them.
        const sheet = { clips: { run: { frames: [0, 'two'], durationSeconds: 1 } } };

        const { specs, warnings } = toSpriteClipSpecs(sheet as SpriteAnimationMetadata);

        expect(specs['run']).toBeUndefined();
        expect(warnings).toHaveLength(1);
    });

    it('drops a clip with an empty frame run', () => {
        const sheet: SpriteAnimationMetadata = {
            clips: { run: { frames: [], durationSeconds: 1 } },
        };

        const { specs, warnings } = toSpriteClipSpecs(sheet);

        expect(specs['run']).toBeUndefined();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('frames');
    });

    it('keeps the usable clips when a sibling is dropped', () => {
        const sheet: SpriteAnimationMetadata = {
            clips: {
                run: { frames: [0, 1], durationSeconds: 0.4 },
                broken: { frames: [2] },
            },
        };

        const { specs, warnings } = toSpriteClipSpecs(sheet);

        expect(Object.keys(specs)).toEqual(['run']);
        expect(warnings).toHaveLength(1);
    });

    it('answers an empty spec map for an absent sheet rather than throwing', () => {
        expect(toSpriteClipSpecs(null)).toEqual({ specs: {}, warnings: [] });
        expect(toSpriteClipSpecs({})).toEqual({ specs: {}, warnings: [] });
        expect(toSpriteClipSpecs({ clips: {} })).toEqual({ specs: {}, warnings: [] });
    });

    it('copies the authored frame run rather than sharing it', () => {
        const frames = [0, 1, 2];
        const sheet: SpriteAnimationMetadata = { clips: { run: { frames, durationSeconds: 1 } } };

        const spec = toSpriteClipSpecs(sheet).specs['run'];

        expect(spec?.frames).toEqual([0, 1, 2]);
        // The backend resolves this run against an atlas and holds it for the
        // life of the playback; sharing the game's array would let a later
        // authoring mutation re-cut a clip already in flight.
        expect(spec?.frames).not.toBe(frames);
    });

    it('does not mutate the authored sheet', () => {
        const sheet: SpriteAnimationMetadata = {
            clips: { run: { frames: [0, 1], durationSeconds: 0.4, loop: 'loop' } },
        };
        const before = JSON.stringify(sheet);

        toSpriteClipSpecs(sheet);

        expect(JSON.stringify(sheet)).toBe(before);
    });

    it('builds the spec map with no inherited prototype keys', () => {
        // Clip names are game-authored data, so a clip called `__proto__` must
        // define an own key rather than write the prototype.
        const sheet = { clips: { ['__proto__']: { frames: [0], durationSeconds: 1 } } };

        const { specs } = toSpriteClipSpecs(sheet);

        expect(Object.prototype.hasOwnProperty.call(specs, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(specs)).toBeNull();
    });
});
