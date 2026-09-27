/**
 * Generator + drift gate for the action app's menu environment map
 * (`apps/action/assets/environment/menu-sky.hdr`).
 *
 * The action shell background mounts a mirror sphere, and a mirror with no
 * environment map renders near-black: a smooth metal has no diffuse term, so
 * what it shows IS the environment. That makes the sphere's pixels a
 * single-frame proof that an HDRI decoded, uploaded and lit a physically-based
 * material — which is the property `apps/action/e2e/tests/environment-map.spec.ts`
 * reads off the screen.
 *
 * A Radiance file is opaque to every text tool in a repo: it cannot be diffed,
 * grepped or reviewed. Committing one on the strength of a comment saying what
 * it contains would put the fixture outside the reach of review permanently, so
 * this module is that comment made executable. `buildActionEnvironmentHdr()`
 * emits the image from readable source numbers, and the committed file is
 * asserted EQUAL to its output byte for byte, by `gen-action-environment-hdr.test.ts`
 * and by the `--check` arm below.
 *
 * Run modes (CLI):
 *   `tsx tools/gen-action-environment-hdr.ts`         — (re)write the committed `.hdr`.
 *   `tsx tools/gen-action-environment-hdr.ts --check` — fail (exit 1) if the committed
 *                                                       bytes have DRIFTED. This is
 *                                                       `verify:environment-hdr`.
 *
 * ## Determinism
 *
 * The byte-equality gate is only meaningful if two machines agree on the bytes.
 * Every channel below comes out of integer endpoints, a rational interpolation
 * and `Math.round`, all of which ECMAScript specifies exactly — unlike
 * `Math.sin`, whose implementation-defined last bit is why the showcase-rig
 * generator authors its quaternions as literals. Nothing here reads a clock, a
 * random source, or the filesystem.
 *
 * ## What the image holds
 *
 * A 128×64 equirectangular sky, vertically graded and constant around the
 * horizontal axis: a bright green overhead falling to a deep green underfoot,
 * authored as two gradient bands meeting at the equator.
 *
 * One HUE throughout, and that is a measurement decision rather than a taste one.
 * A mirror ball shows the directions it reflects, and the ones a camera looking
 * slightly down at it sees are clustered around the horizon — so a sky with a
 * second hue below the equator puts the band boundary across the middle of the
 * ball and leaves its reflection a blend of both. Green everywhere means every
 * reflected direction reads the same, wherever the shell camera's yaw has
 * carried it.
 *
 * Green because nothing in the action arena is: its primitives are amber,
 * sky-blue and slate on a near-black floor, and its selection rings are amber
 * and purple. So a green pixel came from this image and from nothing else, which
 * is what lets the e2e count a hue rather than compare against a golden frame.
 *
 * The upper band carries an exponent of 129, which puts its green channel above
 * 1.0. An environment map is a light source, and a sky clamped to the 0..1 range
 * a display encodes would light nothing brighter than paper — the high dynamic
 * range is the point of the format.
 *
 * ## Why 128 wide, and not smaller
 *
 * A physically-based material samples a PRE-FILTERED form of the map, which three
 * builds itself and sizes from the source. Measured at the installed version by
 * rendering one: an equirectangular source under 64 px wide leaves the material
 * BLACK, with nothing logged. 128 clears that with a step to spare, and the test
 * beside this file holds the width there. A basic material is unaffected, because
 * it does not pre-filter.
 */

/** Where the generated image is committed, relative to the repo root. */
export const ACTION_ENVIRONMENT_HDR_REL_PATH = 'apps/action/assets/environment/menu-sky.hdr';

/** Columns in the equirectangular image. */
export const ACTION_ENVIRONMENT_HDR_WIDTH = 128;
/** Rows in the equirectangular image; row 0 is the zenith. */
export const ACTION_ENVIRONMENT_HDR_HEIGHT = 64;

/**
 * One band of the sky, as Radiance RGBE.
 *
 * `exponent` is the shared power-of-two scale: 128 means ×1, so a channel byte
 * of 255 is a radiance of just under 1, and 129 means ×2.
 */
interface SkyBand {
    readonly fromRgb: readonly [number, number, number];
    readonly toRgb: readonly [number, number, number];
    readonly exponent: number;
}

/** Zenith → horizon: green, brighter than a display can show. */
const UPPER_BAND: SkyBand = {
    fromRgb: [30, 240, 70],
    toRgb: [40, 200, 80],
    exponent: 129,
};

/** Horizon → nadir: the same green, falling to a ground-shadowed deep. */
const LOWER_BAND: SkyBand = {
    fromRgb: [30, 150, 60],
    toRgb: [10, 70, 30],
    exponent: 128,
};

/**
 * The RGBE quadruple for `row`.
 *
 * The interpolation parameter is a ratio of integers, so every machine computes
 * the same IEEE-754 value and `Math.round` closes it to the same byte.
 */
export function actionEnvironmentHdrPixel(row: number): readonly [number, number, number, number] {
    const half = ACTION_ENVIRONMENT_HDR_HEIGHT / 2;
    const upper = row < half;
    const band = upper ? UPPER_BAND : LOWER_BAND;
    const step = upper ? row : row - half;
    const ratio = step / (half - 1);
    return [
        Math.round(band.fromRgb[0] + (band.toRgb[0] - band.fromRgb[0]) * ratio),
        Math.round(band.fromRgb[1] + (band.toRgb[1] - band.fromRgb[1]) * ratio),
        Math.round(band.fromRgb[2] + (band.toRgb[2] - band.fromRgb[2]) * ratio),
        band.exponent,
    ];
}

/**
 * The committed image's bytes.
 *
 * The scanlines are FLAT rather than run-length encoded, which is a decision the
 * decoder makes for us: `HDRLoader` reads a scanline as RLE only when its first
 * bytes are `2, 2, <high byte with bit 7 clear>`, and no band above starts a row
 * with a 2. Emitting flat keeps this generator free of an encoder whose output
 * would be far harder to check by eye than the pixels it encodes.
 */
export function buildActionEnvironmentHdr(): Uint8Array {
    const header = new TextEncoder().encode(
        `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${ACTION_ENVIRONMENT_HDR_HEIGHT} +X ${ACTION_ENVIRONMENT_HDR_WIDTH}\n`,
    );
    const pixels = new Uint8Array(ACTION_ENVIRONMENT_HDR_WIDTH * ACTION_ENVIRONMENT_HDR_HEIGHT * 4);

    for (let row = 0; row < ACTION_ENVIRONMENT_HDR_HEIGHT; row += 1) {
        const [red, green, blue, exponent] = actionEnvironmentHdrPixel(row);
        for (let column = 0; column < ACTION_ENVIRONMENT_HDR_WIDTH; column += 1) {
            const at = (row * ACTION_ENVIRONMENT_HDR_WIDTH + column) * 4;
            pixels[at] = red;
            pixels[at + 1] = green;
            pixels[at + 2] = blue;
            pixels[at + 3] = exponent;
        }
    }

    const bytes = new Uint8Array(header.length + pixels.length);
    bytes.set(header, 0);
    bytes.set(pixels, header.length);
    return bytes;
}

/** True when `committed` is not `expected` byte for byte. */
export function checkEnvironmentHdrDrift(committed: Uint8Array, expected: Uint8Array): boolean {
    if (committed.length !== expected.length) {
        return true;
    }
    return committed.some((byte, index) => byte !== expected[index]);
}

// The CLI entry, excluded from vitest so importing the pure surface above writes
// nothing. An async IIFE because tsx transforms `tools/*.ts` as CommonJS and
// esbuild rejects top-level await in CJS output.

if (process.env['VITEST'] === undefined) {
    void (async (): Promise<void> => {
        const path = await import('node:path');
        const { mkdir, readFile, writeFile } = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');

        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const committedPath = path.join(repoRoot, ACTION_ENVIRONMENT_HDR_REL_PATH);

        try {
            const expected = buildActionEnvironmentHdr();

            if (process.argv.includes('--check')) {
                let committed = new Uint8Array(0);
                try {
                    committed = new Uint8Array(await readFile(committedPath));
                } catch {
                    committed = new Uint8Array(0);
                }
                if (checkEnvironmentHdrDrift(committed, expected)) {
                    console.error(
                        '[verify:environment-hdr] FAILED — menu-sky.hdr is not the generator output.\n' +
                            '  The committed image was hand-edited, re-exported, or the generator changed without a regenerate.\n' +
                            '  Run `pnpm gen:environment-hdr` and commit the result.',
                    );
                    process.exitCode = 1;
                    return;
                }
                console.log('[verify:environment-hdr] OK — committed bytes match the generator.');
                return;
            }

            await mkdir(path.dirname(committedPath), { recursive: true });
            await writeFile(committedPath, expected);
            console.log(`[gen:environment-hdr] Wrote ${committedPath} (${expected.length} bytes).`);
        } catch (error) {
            console.error(
                `[gen:environment-hdr] ${error instanceof Error ? error.message : String(error)}`,
            );
            process.exitCode = 1;
        }
    })();
}
