import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { LOGO_VIDEO_DEFAULT_DURATION_MS } from '../renderer/components/ui/logoVideoScreenDuration';

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

// The boot logo video (§4.37.15). The caps apply to the real brand cut, not
// just the committed placeholder — a few seconds of full-screen H.264. The
// duration cap matters because LogoVideoScreen's watchdog hard-truncates
// playback at LOGO_VIDEO_DEFAULT_DURATION_MS: a longer cut would be silently
// cut off mid-play on every packaged boot.
const MAX_VIDEO_FILE_BYTES = 8_000_000;

// Next serves each host's own public/, so every adopting app commits its own
// copy: engine + tactics (#856) + the blank template (#857).
const shippedLogoVideoPaths = [
    'renderer/public/chimera_logo.mp4',
    'apps/tactics/renderer/public/chimera_logo.mp4',
    'tools/create-chimera-game/templates/blank/renderer/public/chimera_logo.mp4',
] as const;

/**
 * Movie duration lives in the mvhd box: after the 4-byte size, 4-byte 'mvhd'
 * type, and 1+3 bytes version/flags come creation and modification times
 * (4 bytes each in version 0, 8 each in version 1), then timescale (u32,
 * ticks per second) and duration (u32 in version 0, u64 in version 1).
 */
function readMp4DurationMs(mp4: Buffer): number {
    const boxTypeIndex = mp4.indexOf('mvhd', 0, 'latin1');
    expect(boxTypeIndex).toBeGreaterThan(-1);

    const version = mp4.readUInt8(boxTypeIndex + 4);
    const timescale =
        version === 1 ? mp4.readUInt32BE(boxTypeIndex + 24) : mp4.readUInt32BE(boxTypeIndex + 16);
    const duration =
        version === 1
            ? Number(mp4.readBigUInt64BE(boxTypeIndex + 28))
            : mp4.readUInt32BE(boxTypeIndex + 20);

    expect(timescale).toBeGreaterThan(0);
    return (duration / timescale) * 1000;
}

describe.each(shippedLogoVideoPaths)('shipped logo video budget: %s', (relativePath) => {
    const absolutePath = path.join(workspaceRoot, relativePath);

    it('exists', () => {
        expect(existsSync(absolutePath)).toBe(true);
    });

    it(`is an ISO-BMFF mp4 within the boot byte budget (≤${MAX_VIDEO_FILE_BYTES} bytes)`, () => {
        const mp4 = readFileSync(absolutePath);

        // ISO base media file format: bytes 4-8 of the first box are 'ftyp'.
        expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp');
        expect(mp4.byteLength).toBeLessThanOrEqual(MAX_VIDEO_FILE_BYTES);
    });

    it(`stays under the LogoVideoScreen watchdog (≤${LOGO_VIDEO_DEFAULT_DURATION_MS} ms)`, () => {
        const durationMs = readMp4DurationMs(readFileSync(absolutePath));

        expect(durationMs).toBeGreaterThan(0);
        expect(durationMs).toBeLessThanOrEqual(LOGO_VIDEO_DEFAULT_DURATION_MS);
    });
});
