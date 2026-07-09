import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// Guards the shipped boot-smoke logo against decode-budget regressions. The logo
// once shipped as a 1825×1825 / 1.9 MB PNG rendered at 256 px: Chromium paints a
// multi-megapixel PNG progressively across frames, so the boot screen showed the
// image "tearing" in scanline slices no matter how early the fetch started
// (a <link rel="preload"> cannot fix decode time). Keeping the asset at ≤512 px
// (2× the 256 px display size) makes the decode single-frame. The hi-res original
// lives in docs/assets/chimera-logo-compact.png (icon-generation source) and is
// deliberately NOT budgeted here.
const workspaceRoot = path.resolve(import.meta.dirname, '..');

const MAX_DIMENSION_PX = 512;
const MAX_FILE_BYTES = 400_000;

const shippedLogoPaths = [
    'renderer/public/chimera-logo-compact.png',
    'apps/tactics/renderer/public/chimera-logo-compact.png',
    'tools/create-chimera-game/templates/blank/renderer/public/chimera-logo-compact.png',
] as const;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width/height live in the IHDR chunk, big-endian u32 at offsets 16 and 20. */
function readPngDimensions(png: Buffer): { width: number; height: number } {
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe.each(shippedLogoPaths)('shipped logo asset budget: %s', (relativePath) => {
    const absolutePath = path.join(workspaceRoot, relativePath);

    it('exists', () => {
        expect(existsSync(absolutePath)).toBe(true);
    });

    it(`stays within the single-frame decode budget (≤${MAX_DIMENSION_PX}px, ≤${MAX_FILE_BYTES} bytes)`, () => {
        const png = readFileSync(absolutePath);
        const { width, height } = readPngDimensions(png);

        expect(width).toBeLessThanOrEqual(MAX_DIMENSION_PX);
        expect(height).toBeLessThanOrEqual(MAX_DIMENSION_PX);
        expect(png.byteLength).toBeLessThanOrEqual(MAX_FILE_BYTES);
    });
});
