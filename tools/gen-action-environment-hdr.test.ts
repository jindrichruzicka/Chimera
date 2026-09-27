// tools/gen-action-environment-hdr.test.ts
//
// Unit tests for the action menu environment-map generator and its drift gate.
//
// Two properties, and the second is why the generator exists at all:
//
//   1. the builder emits a Radiance image three's own `HDRLoader` decodes, with
//      the hues and the dynamic range the e2e reads off the screen — asserted by
//      DECODING what it produced, never by re-reading the literals that produced
//      it;
//   2. the COMMITTED `.hdr` equals the builder's output byte for byte. A Radiance
//      file is opaque to review: without this, a hand-edited or re-exported image
//      is indistinguishable from the generated one, and the comment claiming it
//      is reproducible is the only thing saying otherwise.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { DataUtils, HalfFloatType, LinearSRGBColorSpace } from 'three';
import type { DataTexture } from 'three';

import {
    ACTION_ENVIRONMENT_HDR_HEIGHT,
    ACTION_ENVIRONMENT_HDR_REL_PATH,
    ACTION_ENVIRONMENT_HDR_WIDTH,
    actionEnvironmentHdrPixel,
    buildActionEnvironmentHdr,
    checkEnvironmentHdrDrift,
} from './gen-action-environment-hdr.js';

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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Decode bytes through the real loader, over a `data:` URL it can fetch. */
async function decode(bytes: Uint8Array): Promise<DataTexture> {
    const url = `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`;
    return new Promise<DataTexture>((resolve, reject) => {
        new HDRLoader().load(url, resolve, undefined, reject);
    });
}

/** The linear RGB triple at one pixel of a decoded half-float image. */
function radianceAt(texture: DataTexture, column: number, row: number): readonly number[] {
    const data = texture.image.data as unknown as Uint16Array;
    const at = (row * ACTION_ENVIRONMENT_HDR_WIDTH + column) * 4;
    return [0, 1, 2].map((channel) => DataUtils.fromHalfFloat(data[at + channel] ?? 0));
}

describe('buildActionEnvironmentHdr', () => {
    it('emits an image three decodes at the authored size', async () => {
        const texture = await decode(buildActionEnvironmentHdr());

        expect(texture.image.width).toBe(ACTION_ENVIRONMENT_HDR_WIDTH);
        expect(texture.image.height).toBe(ACTION_ENVIRONMENT_HDR_HEIGHT);
        expect(texture.colorSpace).toBe(LinearSRGBColorSpace);
        expect(texture.type).toBe(HalfFloatType);
    });

    it('is green in every direction, not only overhead', async () => {
        const texture = await decode(buildActionEnvironmentHdr());

        // Every ROW, because a mirror reflects whichever directions the camera
        // sees it from, and a hue that held only at the zenith would make the
        // e2e's count depend on where the shell camera's yaw sat. Channel
        // dominance rather than exact values: what reaches the screen is a
        // pre-filtered blur of this image, not any one texel.
        for (let row = 0; row < ACTION_ENVIRONMENT_HDR_HEIGHT; row += 1) {
            const [red, green, blue] = radianceAt(texture, 0, row);
            expect(green, `row ${row}`).toBeGreaterThan((red ?? 0) * 2);
            expect(green, `row ${row}`).toBeGreaterThan((blue ?? 0) * 2);
        }
    });

    it('is brighter overhead than underfoot', async () => {
        const texture = await decode(buildActionEnvironmentHdr());

        // The gradient is what stops the ball reading as one flat disc of
        // colour; a sky collapsed to a single value would satisfy the hue
        // assertion above just as well.
        const zenith = radianceAt(texture, 0, 0)[1] ?? 0;
        const nadir = radianceAt(texture, 0, ACTION_ENVIRONMENT_HDR_HEIGHT - 1)[1] ?? 0;

        expect(zenith).toBeGreaterThan(nadir * 4);
    });

    it('is wide enough for three to pre-filter', () => {
        // Measured at the installed three by rendering it: an equirectangular
        // source under 64 px wide leaves a physical material BLACK, with no error
        // raised anywhere. This is the assertion that would red if the image were
        // shrunk for size.
        expect(ACTION_ENVIRONMENT_HDR_WIDTH).toBeGreaterThanOrEqual(64);
    });

    it('carries radiance above the range a display encodes', async () => {
        const texture = await decode(buildActionEnvironmentHdr());

        // The point of the format, and of the 129 exponent on the upper band: a
        // sky clamped to 0..1 lights nothing brighter than paper.
        expect(radianceAt(texture, 0, 0)[1]).toBeGreaterThan(1);
    });

    it('holds the sky constant around the horizontal axis', async () => {
        const texture = await decode(buildActionEnvironmentHdr());

        // The shell camera yaws. A sky with azimuthal detail would change what
        // the sphere shows as it moves, making the e2e's hue counts depend on
        // where the yaw happened to be sampled.
        for (const row of [0, ACTION_ENVIRONMENT_HDR_HEIGHT - 1]) {
            expect(radianceAt(texture, ACTION_ENVIRONMENT_HDR_WIDTH - 1, row)).toEqual(
                radianceAt(texture, 0, row),
            );
        }
    });

    it('emits flat scanlines, which is what keeps the encoder out of this file', () => {
        const bytes = buildActionEnvironmentHdr();
        const headerLength = new TextEncoder().encode(
            `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${ACTION_ENVIRONMENT_HDR_HEIGHT} +X ${ACTION_ENVIRONMENT_HDR_WIDTH}\n`,
        ).length;

        // `HDRLoader` takes the run-length path only when a scanline opens with
        // `2, 2, <high byte>`. Asserting the first two bytes are not both 2 is
        // asserting the decoder takes the flat path.
        expect([bytes[headerLength], bytes[headerLength + 1]]).not.toEqual([2, 2]);
        expect(bytes.length).toBe(
            headerLength + ACTION_ENVIRONMENT_HDR_WIDTH * ACTION_ENVIRONMENT_HDR_HEIGHT * 4,
        );
    });

    it('produces the same bytes on every build', () => {
        // The byte-equality gate below is only meaningful if this holds.
        expect(Buffer.from(buildActionEnvironmentHdr())).toEqual(
            Buffer.from(buildActionEnvironmentHdr()),
        );
    });

    it('grades each band from its first row to its last', () => {
        const half = ACTION_ENVIRONMENT_HDR_HEIGHT / 2;

        // A band whose endpoints were collapsed onto one colour would still pass
        // the hue assertions above; this is what says the gradient is authored.
        expect(actionEnvironmentHdrPixel(0)).not.toEqual(actionEnvironmentHdrPixel(half - 1));
        expect(actionEnvironmentHdrPixel(half)).not.toEqual(
            actionEnvironmentHdrPixel(ACTION_ENVIRONMENT_HDR_HEIGHT - 1),
        );
        // …and that the two bands are different bands, not one graded run.
        expect(actionEnvironmentHdrPixel(half - 1)[3]).not.toBe(actionEnvironmentHdrPixel(half)[3]);
    });
});

describe('checkEnvironmentHdrDrift', () => {
    it('reports a drift for a changed byte and for a truncation', () => {
        const expected = buildActionEnvironmentHdr();
        const changed = Uint8Array.from(expected);
        changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 0xff;

        expect(checkEnvironmentHdrDrift(changed, expected)).toBe(true);
        expect(checkEnvironmentHdrDrift(expected.slice(0, -1), expected)).toBe(true);
        expect(checkEnvironmentHdrDrift(Uint8Array.from(expected), expected)).toBe(false);
    });
});

describe('the committed image', () => {
    it('is the generator output, byte for byte', () => {
        const committed = new Uint8Array(
            readFileSync(path.join(repoRoot, ACTION_ENVIRONMENT_HDR_REL_PATH)),
        );

        expect(checkEnvironmentHdrDrift(committed, buildActionEnvironmentHdr())).toBe(false);
    });
});
