// simulation/foundation/texture-sampling.ts
// §4.10 — Per-entry texture sampling: the vocabulary a manifest entry declares
// it in, and the reader that checks a declaration.
//
// A `'texture'` or `'sprite-sheet'` manifest entry declares how its image is
// sampled under `metadata.sampling`. Every value is an engine-owned NAME or a
// JSON scalar — `'nearest'`, never a graphics-library constant (Invariant #1) —
// so a declaration survives the `JSON.stringify` comparison the renderer's
// asset cache uses to decide whether a re-registered entry is still the same
// asset.
//
// Lives in `simulation/foundation/` so both `simulation/content/` (the authoring
// builders) and `renderer/assets/` can reach the reader without the renderer
// taking a runtime value from `simulation/content/`.
//
// Zero dependencies — no Three.js, no DOM, no electron.

/** How a texture's stored values are interpreted. `'none'` is for data maps. */
export type TextureColorSpace = 'srgb' | 'srgb-linear' | 'none';

/** Filtering when one texel covers more than one pixel. */
export type TextureMagFilter = 'nearest' | 'linear';

/** Filtering when one pixel covers more than one texel. */
export type TextureMinFilter =
    | 'nearest'
    | 'linear'
    | 'nearest-mipmap-nearest'
    | 'nearest-mipmap-linear'
    | 'linear-mipmap-nearest'
    | 'linear-mipmap-linear';

/** What a lookup outside the 0..1 range reads. */
export type TextureWrapMode = 'clamp' | 'repeat' | 'mirrored-repeat';

export const TEXTURE_COLOR_SPACES: readonly TextureColorSpace[] = ['srgb', 'srgb-linear', 'none'];

export const TEXTURE_MAG_FILTERS: readonly TextureMagFilter[] = ['nearest', 'linear'];

export const TEXTURE_MIN_FILTERS: readonly TextureMinFilter[] = [
    'nearest',
    'linear',
    'nearest-mipmap-nearest',
    'nearest-mipmap-linear',
    'linear-mipmap-nearest',
    'linear-mipmap-linear',
];

export const TEXTURE_WRAP_MODES: readonly TextureWrapMode[] = [
    'clamp',
    'repeat',
    'mirrored-repeat',
];

/**
 * How one manifest entry's image is sampled. Every option is optional; an
 * omitted one is left to the loader.
 */
export interface TextureSampling {
    readonly colorSpace?: TextureColorSpace;
    readonly magFilter?: TextureMagFilter;
    readonly minFilter?: TextureMinFilter;
    readonly wrapS?: TextureWrapMode;
    readonly wrapT?: TextureWrapMode;
    readonly flipY?: boolean;
    /** A finite number of at least 1. */
    readonly anisotropy?: number;
    readonly generateMipmaps?: boolean;
}

/** The `metadata` shape a `'texture'` entry carries its sampling in. */
export interface TextureMetadata {
    readonly sampling?: TextureSampling;
}

/** Thrown by {@link readTextureSampling}; `problems` names every fault found. */
export class InvalidTextureSamplingError extends Error {
    constructor(public readonly problems: readonly string[]) {
        super(`Invalid texture sampling: ${problems.join(' ')}`);
        this.name = 'InvalidTextureSamplingError';
    }
}

type OptionCheck = (option: string, value: unknown) => string | null;

function oneOf(names: readonly unknown[]): OptionCheck {
    const listed = names.map((name) => `'${String(name)}'`).join(', ');
    return (option, value) =>
        names.includes(value) ? null : `sampling.${option} must be one of ${listed}.`;
}

const booleanOption: OptionCheck = (option, value) =>
    typeof value === 'boolean' ? null : `sampling.${option} must be a boolean.`;

const OPTION_CHECKS: Readonly<Record<keyof TextureSampling, OptionCheck>> = {
    colorSpace: oneOf(TEXTURE_COLOR_SPACES),
    magFilter: oneOf(TEXTURE_MAG_FILTERS),
    minFilter: oneOf(TEXTURE_MIN_FILTERS),
    wrapS: oneOf(TEXTURE_WRAP_MODES),
    wrapT: oneOf(TEXTURE_WRAP_MODES),
    flipY: booleanOption,
    // Finite, because `JSON.stringify` writes NaN and Infinity as `null`. NaN
    // already fails the lower bound.
    anisotropy: (option, value) =>
        typeof value === 'number' && value >= 1 && value !== Number.POSITIVE_INFINITY
            ? null
            : `sampling.${option} must be a finite number of at least 1.`,
    generateMipmaps: booleanOption,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the sampling declared in a manifest entry's `metadata` slot.
 *
 * Returns `undefined` when the slot declares none — it is not an object, or has
 * no `sampling` key — and the declaration itself, unchanged, when every option
 * is valid. Sibling keys are not this reader's business: a sprite sheet's clip
 * sheet shares the slot.
 *
 * @throws {InvalidTextureSamplingError} When `sampling` is not an object, names
 *   an option that does not exist, or gives an option a value outside its
 *   vocabulary. A misspelled option is a fault, never silently dropped.
 */
export function readTextureSampling(metadata: unknown): TextureSampling | undefined {
    const sampling = (metadata as { readonly sampling?: unknown } | null | undefined)?.sampling;
    if (sampling === undefined) {
        return undefined;
    }
    if (!isRecord(sampling)) {
        throw new InvalidTextureSamplingError(['sampling must be an object.']);
    }

    const problems: string[] = [];
    for (const [option, value] of Object.entries(sampling)) {
        const check = Object.hasOwn(OPTION_CHECKS, option)
            ? OPTION_CHECKS[option as keyof TextureSampling]
            : undefined;
        const problem =
            check === undefined
                ? `sampling.${option} is not a sampling option.`
                : check(option, value);
        if (problem !== null) {
            problems.push(problem);
        }
    }

    if (problems.length > 0) {
        throw new InvalidTextureSamplingError(problems);
    }
    return sampling;
}
