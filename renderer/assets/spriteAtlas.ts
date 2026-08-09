/**
 * renderer/assets/spriteAtlas.ts
 *
 * Turns a loaded sprite sheet's atlas descriptor into measured, UV-ready cells.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Fail-soft, like the sheet readers next door: `null` when there is no atlas to
 * measure, a refusal plus a warning per unusable cell, and no throw on any path.
 * The `Texture` is manager-owned — this module READS its decoded dimensions and
 * never writes, configures or disposes it (Invariant #21).
 *
 * **The UV form, written once.** The four pairs on each frame are RAW `uv`
 * attribute values, in `THREE.PlaneGeometry`'s own vertex order — top-left,
 * top-right, bottom-left, bottom-right — so a caller assigns them straight onto
 * a plane's `uv` attribute. They are NOT the `offset`/`repeat` form; transcribing
 * between the two is a coin-flip on vertical orientation, which is why only one
 * form is written here.
 *
 * `v` runs UP the image because `AssetManager.loadSpriteSheet` loads through
 * `new TextureLoader()` and three's `Texture.flipY` defaults to `true`, so the
 * decode has already flipped the rows: `v = 1` samples the image's TOP row. An
 * atlas rect's `y` is measured DOWN from that top row, so
 *
 *     u0 = x / imageWidth              u1 = (x + w) / imageWidth
 *     vTop = 1 - y / imageHeight       vBottom = 1 - (y + h) / imageHeight
 *
 * and the four pairs are `[u0, vTop] [u1, vTop] [u0, vBottom] [u1, vBottom]`.
 *
 * **Frame order is the atlas's own.** Cells come out in the order the descriptor
 * declares them, unsorted, because that is the order an atlas tool writes a clip's
 * run in. Sorting by name would look tidier and quietly put `run_10` before
 * `run_2`. Every frame carries its `name`, so a caller that wants a different
 * order has what it needs to build one.
 */

import type { Texture } from 'three';

import type { LoadedSpriteSheetAsset } from './AssetManager.js';

/** One measured atlas cell: its pixel rect, and the UVs that sample it. */
export interface SpriteAtlasFrame {
    /** The cell's key in the atlas descriptor. */
    readonly name: string;
    /** Pixel offset from the image's LEFT edge. */
    readonly x: number;
    /** Pixel offset DOWN from the image's TOP edge. */
    readonly y: number;
    /** Cell width in pixels. Always positive. */
    readonly width: number;
    /** Cell height in pixels. Always positive. */
    readonly height: number;
    /** Raw `uv` pairs, in `PlaneGeometry` order: top-left, top-right, bottom-left, bottom-right. */
    readonly uv: readonly [
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
    ];
}

/** A measured sprite sheet: the image it was measured against, and its cells. */
export interface SpriteAtlas {
    /** The decoded image width the UVs were divided by. Finite and positive. */
    readonly imageWidth: number;
    /** The decoded image height the UVs were divided by. Finite and positive. */
    readonly imageHeight: number;
    /** Usable cells, in declaration order. May be empty when every cell was refused. */
    readonly frames: readonly SpriteAtlasFrame[];
    /** At most one string per refused cell. Never empty strings. */
    readonly warnings: readonly string[];
}

/**
 * Measure `asset`'s atlas descriptor against its decoded texture.
 *
 * Returns `null` only when there is nothing to measure: a sheet loaded straight
 * from an image (no descriptor), a descriptor that is not a record, or a texture
 * whose decoded image reports no usable dimensions. A descriptor whose every cell
 * is unusable measures to an EMPTY frame list instead — the sheet IS an atlas,
 * and the warnings say what is wrong with it.
 */
export function parseSpriteAtlas(asset: LoadedSpriteSheetAsset): SpriteAtlas | null {
    const rawFrames: unknown = asset.frames;
    if (!isRecord(rawFrames)) {
        return null;
    }

    const size = readImageSize(asset.texture);
    if (size === null) {
        return null;
    }
    const [imageWidth, imageHeight] = size;

    const frames: SpriteAtlasFrame[] = [];
    const warnings: string[] = [];
    for (const [name, rawFrame] of Object.entries(rawFrames)) {
        const frame = readFrame(name, rawFrame, imageWidth, imageHeight);
        if (typeof frame === 'string') {
            warnings.push(frame);
        } else {
            frames.push(frame);
        }
    }

    return { imageWidth, imageHeight, frames, warnings };
}

// ─── internals ──────────────────────────────────────────────────────────────────

/** The decoded `[width, height]`, or `null` when the texture cannot report one. */
function readImageSize(texture: Texture | undefined): readonly [number, number] | null {
    // `Texture.image` is whatever the loader put there — an `ImageBitmap`, an
    // `HTMLImageElement`, or nothing at all while a load is still in flight. It
    // is read through `unknown` because the declared type promises none of that.
    const image: unknown = (texture as { readonly image?: unknown } | undefined)?.image;
    if (!isRecord(image)) {
        return null;
    }
    const width = image['width'];
    const height = image['height'];
    if (!isFinitePositive(width) || !isFinitePositive(height)) {
        return null;
    }
    return [width, height];
}

/** A measured cell, or the warning string explaining why it was refused. */
function readFrame(
    name: string,
    rawFrame: unknown,
    imageWidth: number,
    imageHeight: number,
): SpriteAtlasFrame | string {
    if (!isRecord(rawFrame)) {
        return `Sprite atlas frame '${name}' is not an object; refusing the frame.`;
    }

    // Refused rather than un-rotated or re-inset: both flags mean the pixels in
    // the sheet are not the pixels the frame describes, and reconstructing the
    // difference from a descriptor that may or may not carry the source rect is
    // a guess. A frame declaring either as `false` is an ordinary frame.
    if (rawFrame['rotated'] === true) {
        return `Sprite atlas frame '${name}' declares rotated: true, which this reader does not un-rotate; refusing the frame.`;
    }
    if (rawFrame['trimmed'] === true) {
        return `Sprite atlas frame '${name}' declares trimmed: true, which this reader does not re-inset; refusing the frame.`;
    }

    // Atlas tools write the rect either flat on the frame or nested under
    // `frame`; the two flags above sit beside `frame` in the nested form.
    const nested = rawFrame['frame'];
    const rect = isRecord(nested) ? nested : rawFrame;
    const x = rect['x'];
    const y = rect['y'];
    const width = rect['w'];
    const height = rect['h'];

    if (
        !isFiniteNonNegative(x) ||
        !isFiniteNonNegative(y) ||
        !isFinitePositive(width) ||
        !isFinitePositive(height)
    ) {
        return `Sprite atlas frame '${name}' declares no usable { x, y, w, h } rect; refusing the frame.`;
    }
    if (x + width > imageWidth || y + height > imageHeight) {
        return `Sprite atlas frame '${name}' reaches past the ${imageWidth}x${imageHeight} image it is cut from; refusing the frame.`;
    }

    const u0 = x / imageWidth;
    const u1 = (x + width) / imageWidth;
    const vTop = 1 - y / imageHeight;
    const vBottom = 1 - (y + height) / imageHeight;

    return {
        name,
        x,
        y,
        width,
        height,
        uv: [
            [u0, vTop],
            [u1, vTop],
            [u0, vBottom],
            [u1, vBottom],
        ],
    };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
