/**
 * simulation/foundation/texture-sampling.test.ts
 *
 * Unit tests for the sim-side texture sampling vocabulary and its reader,
 * `readTextureSampling`.
 *
 * Architecture reference: §4.10 — Asset Reference System.
 *
 * Invariants upheld:
 *   #1 — `simulation/` has zero runtime dependencies on React, DOM, or a
 *     graphics library, so every declarable value is an engine-owned name or a
 *     JSON scalar.
 *   §3 Module Boundary — `simulation/foundation/` is the zero-dependency engine
 *     leaf; the module under test imports nothing.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
    InvalidTextureSamplingError,
    readTextureSampling,
    TEXTURE_COLOR_SPACES,
    TEXTURE_MAG_FILTERS,
    TEXTURE_MIN_FILTERS,
    TEXTURE_WRAP_MODES,
    type TextureColorSpace,
    type TextureMagFilter,
    type TextureMinFilter,
    type TextureSampling,
    type TextureWrapMode,
} from './texture-sampling.js';

// `Required`: an option added to the vocabulary fails this fixture at typecheck
// until it is declared here, and so reaches the round-trip case below.
const EVERY_OPTION: Required<TextureSampling> = {
    colorSpace: 'srgb',
    magFilter: 'nearest',
    minFilter: 'linear-mipmap-linear',
    wrapS: 'repeat',
    wrapT: 'mirrored-repeat',
    flipY: false,
    anisotropy: 4,
    generateMipmaps: true,
};

function problemsOf(metadata: unknown): readonly string[] {
    try {
        readTextureSampling(metadata);
    } catch (error: unknown) {
        if (error instanceof InvalidTextureSamplingError) {
            return error.problems;
        }
        throw error;
    }
    return [];
}

describe('texture sampling vocabulary', () => {
    it('pins the engine-owned names of each enumerated option', () => {
        expectTypeOf<TextureColorSpace>().toEqualTypeOf<'srgb' | 'srgb-linear' | 'none'>();
        expectTypeOf<TextureMagFilter>().toEqualTypeOf<'nearest' | 'linear'>();
        expectTypeOf<TextureMinFilter>().toEqualTypeOf<
            | 'nearest'
            | 'linear'
            | 'nearest-mipmap-nearest'
            | 'nearest-mipmap-linear'
            | 'linear-mipmap-nearest'
            | 'linear-mipmap-linear'
        >();
        expectTypeOf<TextureWrapMode>().toEqualTypeOf<'clamp' | 'repeat' | 'mirrored-repeat'>();

        expect(TEXTURE_COLOR_SPACES).toEqual(['srgb', 'srgb-linear', 'none']);
        expect(TEXTURE_MAG_FILTERS).toEqual(['nearest', 'linear']);
        expect(TEXTURE_MIN_FILTERS).toEqual([
            'nearest',
            'linear',
            'nearest-mipmap-nearest',
            'nearest-mipmap-linear',
            'linear-mipmap-nearest',
            'linear-mipmap-linear',
        ]);
        expect(TEXTURE_WRAP_MODES).toEqual(['clamp', 'repeat', 'mirrored-repeat']);
    });

    it('rejects a misspelled option at compile time', () => {
        const misspelled: TextureSampling = {
            // @ts-expect-error: 'colourSpace' is not a sampling option
            colourSpace: 'srgb',
        };
        expect(Object.keys(misspelled)).toEqual(['colourSpace']);
    });

    it('rejects a three-style numeric filter constant at compile time', () => {
        const numeric: TextureSampling = {
            // @ts-expect-error: filters are engine-owned names, never numeric constants
            magFilter: 1003,
        };
        expect(numeric.magFilter).toBe(1003);
    });
});

describe('readTextureSampling', () => {
    it('returns undefined when the metadata slot carries no sampling', () => {
        expect(readTextureSampling(undefined)).toBeUndefined();
        expect(readTextureSampling(null)).toBeUndefined();
        expect(readTextureSampling('not-an-object')).toBeUndefined();
        expect(readTextureSampling({ clips: {} })).toBeUndefined();
    });

    it('returns the declared sampling verbatim when every option is valid', () => {
        expect(readTextureSampling({ sampling: EVERY_OPTION })).toBe(EVERY_OPTION);
    });

    it('accepts an empty sampling declaration', () => {
        expect(readTextureSampling({ sampling: {} })).toEqual({});
    });

    it('ignores sibling metadata keys, so a sprite clip sheet can share the slot', () => {
        const sampling: TextureSampling = { magFilter: 'nearest' };
        expect(readTextureSampling({ clips: { run: {} }, sampling })).toBe(sampling);
    });

    it.each(TEXTURE_COLOR_SPACES)('accepts colorSpace %s', (colorSpace) => {
        expect(readTextureSampling({ sampling: { colorSpace } })).toEqual({ colorSpace });
    });

    it.each(TEXTURE_MAG_FILTERS)('accepts magFilter %s', (magFilter) => {
        expect(readTextureSampling({ sampling: { magFilter } })).toEqual({ magFilter });
    });

    it.each(TEXTURE_MIN_FILTERS)('accepts minFilter %s', (minFilter) => {
        expect(readTextureSampling({ sampling: { minFilter } })).toEqual({ minFilter });
    });

    it.each(TEXTURE_WRAP_MODES)('accepts wrap mode %s on either axis', (wrap) => {
        expect(readTextureSampling({ sampling: { wrapS: wrap } })).toEqual({ wrapS: wrap });
        expect(readTextureSampling({ sampling: { wrapT: wrap } })).toEqual({ wrapT: wrap });
    });

    it('rejects a sampling declaration that is not a plain object', () => {
        expect(problemsOf({ sampling: 'srgb' })).toEqual(['sampling must be an object.']);
        expect(problemsOf({ sampling: null })).toEqual(['sampling must be an object.']);
        expect(problemsOf({ sampling: ['srgb'] })).toEqual(['sampling must be an object.']);
    });

    it('rejects a misspelled option rather than ignoring it', () => {
        expect(problemsOf({ sampling: { colourSpace: 'srgb' } })).toEqual([
            'sampling.colourSpace is not a sampling option.',
        ]);
    });

    it('rejects an option named like an inherited object member', () => {
        expect(problemsOf({ sampling: { constructor: 'srgb' } })).toEqual([
            'sampling.constructor is not a sampling option.',
        ]);
    });

    it.each([
        ['colorSpace', 'sRGB', "sampling.colorSpace must be one of 'srgb', 'srgb-linear', 'none'."],
        [
            'magFilter',
            'linear-mipmap-linear',
            "sampling.magFilter must be one of 'nearest', 'linear'.",
        ],
        [
            'minFilter',
            'trilinear',
            "sampling.minFilter must be one of 'nearest', 'linear', 'nearest-mipmap-nearest', 'nearest-mipmap-linear', 'linear-mipmap-nearest', 'linear-mipmap-linear'.",
        ],
        ['wrapS', 'mirror', "sampling.wrapS must be one of 'clamp', 'repeat', 'mirrored-repeat'."],
        ['wrapT', 1000, "sampling.wrapT must be one of 'clamp', 'repeat', 'mirrored-repeat'."],
        ['flipY', 'false', 'sampling.flipY must be a boolean.'],
        ['generateMipmaps', 0, 'sampling.generateMipmaps must be a boolean.'],
    ] as const)('rejects an invalid %s', (option, value, problem) => {
        expect(problemsOf({ sampling: { [option]: value } })).toEqual([problem]);
    });

    it('accepts an anisotropy of exactly 1 and rejects anything below it', () => {
        expect(readTextureSampling({ sampling: { anisotropy: 1 } })).toEqual({ anisotropy: 1 });
        expect(problemsOf({ sampling: { anisotropy: 0.5 } })).toEqual([
            'sampling.anisotropy must be a finite number of at least 1.',
        ]);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, '4', null])(
        'rejects a non-finite or non-numeric anisotropy (%s)',
        (anisotropy) => {
            expect(problemsOf({ sampling: { anisotropy } })).toEqual([
                'sampling.anisotropy must be a finite number of at least 1.',
            ]);
        },
    );

    it('reports every problem of one declaration together', () => {
        expect(
            problemsOf({ sampling: { colorSpace: 'rgb', flipY: 1, filter: 'nearest' } }),
        ).toEqual([
            "sampling.colorSpace must be one of 'srgb', 'srgb-linear', 'none'.",
            'sampling.flipY must be a boolean.',
            'sampling.filter is not a sampling option.',
        ]);
    });

    it('names the problems in the thrown error message', () => {
        expect(() => readTextureSampling({ sampling: { flipY: 1 } })).toThrow(
            new InvalidTextureSamplingError(['sampling.flipY must be a boolean.']),
        );
        expect(new InvalidTextureSamplingError(['a.', 'b.']).message).toBe(
            'Invalid texture sampling: a. b.',
        );
        expect(new InvalidTextureSamplingError([]).name).toBe('InvalidTextureSamplingError');
    });

    it('does not mutate the metadata it reads', () => {
        const metadata = Object.freeze({ sampling: Object.freeze({ ...EVERY_OPTION }) });
        expect(() => readTextureSampling(metadata)).not.toThrow();
    });

    it('each enumerated name, both booleans and an anisotropy at each end survive a JSON round trip', () => {
        const declarations: TextureSampling[] = [
            EVERY_OPTION,
            ...TEXTURE_COLOR_SPACES.map((colorSpace) => ({ colorSpace })),
            ...TEXTURE_MAG_FILTERS.map((magFilter) => ({ magFilter })),
            ...TEXTURE_MIN_FILTERS.map((minFilter) => ({ minFilter })),
            ...TEXTURE_WRAP_MODES.map((wrap) => ({ wrapS: wrap, wrapT: wrap })),
            { flipY: true },
            { flipY: false },
            { generateMipmaps: true },
            { generateMipmaps: false },
            { anisotropy: 1 },
            { anisotropy: 16 },
        ];

        for (const sampling of declarations) {
            const roundTripped: unknown = JSON.parse(JSON.stringify({ sampling }));
            expect(roundTripped).toEqual({ sampling });
            expect(readTextureSampling(roundTripped)).toEqual(sampling);
        }
    });
});
