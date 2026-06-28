import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ICON_BASENAME, PNG_SIZES, generateIcons } from './generate-icons';

/**
 * F67 T1 (#811) — the icon generator derives the platform set (`.icns`/`.ico` +
 * loose PNGs) from a single master logo PNG. These tests drive a synthetic in-memory
 * master (no repo asset) into a temp dir so they stay fast and deterministic, and
 * assert the contract F67 T2 (dev-runtime default) and F67 T4 (packaging) depend on:
 * the canonical filenames exist, each loose PNG decodes to its exact square size, and
 * the container files carry valid `.icns`/`.ico` magic headers.
 */
describe('generateIcons', () => {
    let outDir: string;
    let sourcePng: string;

    beforeEach(async () => {
        outDir = await mkdtemp(path.join(tmpdir(), 'chimera-icons-out-'));
        const srcDir = await mkdtemp(path.join(tmpdir(), 'chimera-icons-src-'));
        sourcePng = path.join(srcDir, 'master.png');
        // A transparent square master, large enough that every target size is a downscale.
        await sharp({
            create: {
                width: 1024,
                height: 1024,
                channels: 4,
                background: { r: 255, g: 80, b: 0, alpha: 1 },
            },
        })
            .png()
            .toFile(sourcePng);
    });

    afterEach(async () => {
        await rm(outDir, { recursive: true, force: true });
        await rm(path.dirname(sourcePng), { recursive: true, force: true });
    });

    it('writes a loose PNG at every declared size, each decoding to its exact square dimensions', async () => {
        await generateIcons({ sourcePng, outDir });

        for (const size of PNG_SIZES) {
            const file = path.join(outDir, `${DEFAULT_ICON_BASENAME}-${size}.png`);
            const meta = await sharp(file).metadata();
            expect(meta.format).toBe('png');
            expect(meta.width).toBe(size);
            expect(meta.height).toBe(size);
        }
    });

    it('writes the dev-runtime default `chimera.png` at 512×512 (the F67 T2 stable filename)', async () => {
        await generateIcons({ sourcePng, outDir });

        const meta = await sharp(path.join(outDir, `${DEFAULT_ICON_BASENAME}.png`)).metadata();
        expect(meta.format).toBe('png');
        expect(meta.width).toBe(512);
        expect(meta.height).toBe(512);
    });

    it('writes a macOS `.icns` carrying the `icns` magic header', async () => {
        await generateIcons({ sourcePng, outDir });

        const icns = await readFile(path.join(outDir, `${DEFAULT_ICON_BASENAME}.icns`));
        expect(icns.byteLength).toBeGreaterThan(0);
        expect(icns.subarray(0, 4).toString('ascii')).toBe('icns');
    });

    it('writes a Windows `.ico` with a valid ICONDIR header (reserved=0, type=1)', async () => {
        await generateIcons({ sourcePng, outDir });

        const ico = await readFile(path.join(outDir, `${DEFAULT_ICON_BASENAME}.ico`));
        expect(ico.byteLength).toBeGreaterThan(0);
        expect(ico.readUInt16LE(0)).toBe(0); // reserved
        expect(ico.readUInt16LE(2)).toBe(1); // image type: 1 = icon (.ico)
    });

    it('returns every written filename, sorted', async () => {
        const result = await generateIcons({ sourcePng, outDir });

        const expected = [
            `${DEFAULT_ICON_BASENAME}.icns`,
            `${DEFAULT_ICON_BASENAME}.ico`,
            `${DEFAULT_ICON_BASENAME}.png`,
            ...PNG_SIZES.map((size) => `${DEFAULT_ICON_BASENAME}-${size}.png`),
        ].sort();
        expect([...result.written].sort()).toEqual(expected);

        // Every reported file must actually exist on disk.
        for (const name of result.written) {
            const info = await stat(path.join(outDir, name));
            expect(info.isFile()).toBe(true);
        }
    });
});
