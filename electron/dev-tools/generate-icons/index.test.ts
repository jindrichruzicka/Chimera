import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
    ScriptKind,
    ScriptTarget,
    createSourceFile,
    forEachChild,
    isCallExpression,
    isExportDeclaration,
    isExternalModuleReference,
    isIdentifier,
    isImportDeclaration,
    isImportEqualsDeclaration,
    isNamedExports,
    isNamedImports,
    isStringLiteral,
} from 'typescript';
import type {
    ExportDeclaration,
    Expression,
    ImportDeclaration,
    Node,
    SourceFile,
} from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_ICON_BASENAME,
    DEFAULT_OUT_REL,
    DEFAULT_SOURCE_REL,
    MISSING_CODEC_MESSAGE,
    PNG_SIZES,
    generateIcons,
    loadImageCodec,
    parseCliArgs,
    runGenerateIconsCli,
} from './index.js';
import type { ModuleImporter } from './index.js';

/**
 * electron/dev-tools/generate-icons/index.test.ts
 *
 * The icon generator derives the platform set (`.icns`/`.ico` + loose PNGs) from a
 * single square master logo PNG. These tests drive a synthetic in-memory master (no
 * repo asset) into a temp dir so they stay fast and deterministic, and assert the
 * contract the generator's two consumers depend on — the dev-runtime window icon and
 * the packaging set: the canonical filenames exist, each loose PNG decodes to its
 * exact square size, and the container files carry valid `.icns`/`.ico` headers.
 *
 * The container CONTENTS are graded separately, in `generated container entries`
 * below, and across several master widths. Everything here drives a 1024px master,
 * which is exactly the fixture under which the non-square-entry defect shipped: a
 * power-of-two master divides every target size evenly, so the bug was invisible to
 * a suite that only ever used one.
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

    it('writes the dev-runtime default `chimera.png` at 512×512, the stable size-less filename', async () => {
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
        // Compared as returned, not re-sorted: `expected` is already in sorted
        // order, so this is the only assertion that can observe the documented
        // ordering. Sorting the actual first would green over its removal —
        // files are pushed in generation order, which is not sorted order.
        expect(result.written).toEqual(expected);

        // Every reported file must actually exist on disk.
        for (const name of result.written) {
            const info = await stat(path.join(outDir, name));
            expect(info.isFile()).toBe(true);
        }
    });

    it('reports the actionable codec error rather than failing somewhere downstream', async () => {
        // Injected rather than observed: the monorepo always has the codec
        // installed, so the uninstalled case is unreachable from a test that
        // cannot uninstall a native binary.
        await expect(
            generateIcons({
                sourcePng,
                outDir,
                importer: () => Promise.reject(missingModule('sharp')),
            }),
        ).rejects.toThrow(MISSING_CODEC_MESSAGE);
    });

    it('creates no output directory when the codec is absent', async () => {
        // Only a directory that does not already exist can show the ordering:
        // `outDir` is created by the fixture, so a nested path is what makes it
        // observable.
        const nested = path.join(outDir, 'nested', 'icons');

        await expect(
            generateIcons({
                sourcePng,
                outDir: nested,
                importer: () => Promise.reject(missingModule('sharp')),
            }),
        ).rejects.toThrow(MISSING_CODEC_MESSAGE);

        await expect(stat(nested)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('creates no output directory when the master cannot be read', async () => {
        // The OTHER way this run ends early. Asserted separately because it is a
        // different statement's ordering: the codec case only constrains the
        // load, this one constrains the master read. Reachable through the CLI
        // only for a master that exists but cannot be opened — a plain missing
        // path is intercepted by `runGenerateIconsCli`'s own check — and always
        // reachable for a direct caller of `generateIcons`.
        const nested = path.join(outDir, 'nested', 'icons');

        await expect(
            generateIcons({ sourcePng: path.join(outDir, 'no-such-master.png'), outDir: nested }),
        ).rejects.toMatchObject({ code: 'ENOENT' });

        await expect(stat(nested)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

/**
 * Master widths chosen to make the squareness assertion bite rather than to be
 * representative. A power-of-two master divides every target size evenly, so a
 * generator that derives its output height by scaling the source — `floor(srcHeight *
 * (target / srcWidth))` — lands on the exact integer and looks correct at every size.
 * 1825 is the real repo master's width, and the double round-trip through that ratio
 * lands JUST below the integer for exactly the power-of-two targets:
 * `32 / 1825 * 1825 === 31.999999999999996`. The set that shipped had every
 * power-of-two entry one pixel short in height and every other entry square, and a
 * 1024-only fixture is what let it ship.
 */
const MASTER_WIDTHS = [1825, 1024, 999] as const;

/** One image inside a container: where it sits, what the container claims, what it is. */
interface ContainerEntry {
    /** ICNS chunk type, or the ICO directory index — whatever names the slot. */
    readonly slot: string;
    /** The size the CONTAINER claims, for formats that declare one; `null` for ICNS. */
    readonly declared: { readonly width: number; readonly height: number } | null;
    /** The size the payload's own PNG header carries. */
    readonly width: number;
    readonly height: number;
}

describe('generated container entries', () => {
    let outDir: string;
    let srcDir: string;

    beforeEach(async () => {
        outDir = await mkdtemp(path.join(tmpdir(), 'chimera-icons-out-'));
        srcDir = await mkdtemp(path.join(tmpdir(), 'chimera-icons-src-'));
    });

    afterEach(async () => {
        await rm(outDir, { recursive: true, force: true });
        await rm(srcDir, { recursive: true, force: true });
    });

    /** Writes a master of `width`×`height` px into the scratch dir; returns its path. */
    async function writeMaster(width: number, height: number): Promise<string> {
        const master = path.join(srcDir, `master-${width}x${height}.png`);
        await sharp({
            create: {
                width,
                height,
                channels: 4,
                background: { r: 255, g: 80, b: 0, alpha: 1 },
            },
        })
            .png()
            .toFile(master);
        return master;
    }

    /** A square master of `width` px. */
    const squareMaster = (width: number): Promise<string> => writeMaster(width, width);

    /** Writes a master of `width`×`height` px (square by default) and generates from it. */
    async function generateFromMaster(width: number, height: number = width): Promise<void> {
        await generateIcons({ sourcePng: await writeMaster(width, height), outDir });
    }

    it.each(MASTER_WIDTHS)(
        'writes only exactly-square .icns entries from a %ipx master',
        async (width) => {
            await generateFromMaster(width);

            const entries = icnsPngEntries(
                await readFile(path.join(outDir, `${DEFAULT_ICON_BASENAME}.icns`)),
            );

            // Negative control, asserted before the property: a parser that found
            // nothing satisfies "every entry is square" vacuously, and would green
            // this test over a container with no images in it at all.
            expect(entries.length).toBeGreaterThan(0);

            expect(entries.filter((entry) => entry.width !== entry.height)).toEqual([]);
        },
    );

    it.each(MASTER_WIDTHS)(
        'writes only exactly-square .ico entries, matching their directory, from a %ipx master',
        async (width) => {
            await generateFromMaster(width);

            const entries = icoEntries(
                await readFile(path.join(outDir, `${DEFAULT_ICON_BASENAME}.ico`)),
            );

            expect(entries.length).toBeGreaterThan(0);

            expect(entries.filter((entry) => entry.width !== entry.height)).toEqual([]);
            // The directory is what a shell reads to pick an entry; a payload that
            // disagrees with it is displayed at the declared size and resampled.
            expect(
                entries.filter(
                    (entry) =>
                        entry.declared?.width !== entry.width ||
                        entry.declared.height !== entry.height,
                ),
            ).toEqual([]);
        },
    );

    it('fills exactly the .icns slots macOS reads, each at the size its slot means', async () => {
        // Written out rather than derived from `ICNS_SLOTS`: comparing the output
        // against the constant that produced it asserts only that the loop ran.
        // The sizes are not free either — `ic13`/`ic14` are the @2x slots of the
        // size below them, so they are the same pixel count as `ic08`/`ic09`, and
        // a map that "simplified" that away would halve the Retina ladder.
        await generateFromMaster(1825);

        const bySlot = Object.fromEntries(
            icnsPngEntries(await readFile(path.join(outDir, `${DEFAULT_ICON_BASENAME}.icns`))).map(
                (entry) => [entry.slot, entry.width],
            ),
        );

        expect(bySlot).toEqual({
            ic07: 128,
            ic08: 256,
            ic09: 512,
            ic10: 1024,
            ic11: 32,
            ic12: 64,
            ic13: 256,
            ic14: 512,
        });
    });

    it('carries no chunk beyond those eight — none duplicated, none non-PNG', async () => {
        // `Object.fromEntries` above collapses a duplicate slot onto one key, and
        // `icnsPngEntries` SKIPS a payload that is not a PNG. So a file with `ic07`
        // twice, or with a truncated/garbage payload alongside the eight, satisfies
        // the slot map exactly. Counting the RAW chunks against the PNG entries is
        // what closes both: it is the only assertion here that can observe a chunk
        // the slot map cannot see.
        await generateFromMaster(1825);

        const icns = await readFile(path.join(outDir, `${DEFAULT_ICON_BASENAME}.icns`));
        const chunks = icnsChunkSlots(icns);
        const pngEntries = icnsPngEntries(icns);

        expect(chunks).toHaveLength(8);
        expect(pngEntries).toHaveLength(chunks.length);
        expect([...new Set(chunks)]).toHaveLength(chunks.length);
    });

    it('fills the .ico ladder, largest first, with a 256 entry the Windows build requires', async () => {
        // The 256 is a build gate, not a nicety: electron-builder validates
        // `win.icon` through its `app-builder` binary and fails the whole Windows
        // build with ERR_ICON_TOO_SMALL when the largest entry is under 256×256.
        // The set that shipped topped out at 256×255 and did exactly that.
        await generateFromMaster(1825);

        const entries = icoEntries(
            await readFile(path.join(outDir, `${DEFAULT_ICON_BASENAME}.ico`)),
        );

        expect(entries.map((entry) => entry.width)).toEqual([256, 128, 96, 64, 48, 32, 24, 16]);
        // Asserted on the DECLARED byte too, because 256 is the one size the
        // format's single-byte width field cannot spell — it is stored as 0, and
        // an encoder that wrote 256 there would truncate to 0 by accident and look
        // correct right up until it did not.
        expect(entries[0]?.declared).toEqual({ width: 256, height: 256 });
    });

    /**
     * A codec stand-in whose renders are whatever `render` says, driven through the
     * public `importer` seam. The real `sharp` cannot be made to return a wrong-sized
     * PNG, so this is the only way to reach the render self-check — and without
     * reaching it, that check can be deleted with the whole suite still green.
     */
    function codecReturning(render: (size: number) => Buffer): ModuleImporter {
        const factory = () => ({
            resize: (width: number) => ({
                png: () => ({ toBuffer: () => Promise.resolve(render(width)) }),
            }),
        });
        return () => Promise.resolve({ default: factory });
    }

    /** A real, valid PNG of the given dimensions. */
    async function pngOf(width: number, height: number): Promise<Buffer> {
        return sharp({
            create: { width, height, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
        })
            .png()
            .toBuffer();
    }

    /**
     * A codec that is CORRECT at every size except `badSize`, where it hands back
     * `bad`. Correct-everywhere-but-one rather than wrong-everywhere on purpose: a
     * codec that is wrong at every size is caught by whichever render happens to run
     * first, which would pass even if the check only ever ran once.
     */
    async function codecBadAt(badSize: number, bad: Buffer): Promise<ModuleImporter> {
        const good = new Map<number, Buffer>();
        for (const size of [1024, 512, 256, 128, 96, 64, 48, 32, 24, 16]) {
            good.set(size, await pngOf(size, size));
        }
        return codecReturning((size) => (size === badSize ? bad : good.get(size)!));
    }

    it('refuses a render that came back the wrong size, naming the size that failed', async () => {
        // The defect class this module exists to have fixed, injected directly: a
        // resize that returns 256×255 produces a perfectly valid PNG, and the
        // container assembles around it without complaint. Nothing downstream of
        // this check can tell that render from a correct one.
        await expect(
            generateIcons({
                sourcePng: await squareMaster(1024),
                outDir,
                importer: await codecBadAt(256, await pngOf(256, 255)),
            }),
        ).rejects.toThrow(/the 256px render came out 256×255/u);
    });

    it('refuses a render that is not a PNG at all', async () => {
        // The other arm of the same check. Separate because it is a different
        // statement: a codec handing back something undecodable would otherwise be
        // written into the container as an opaque payload, which `icnsPngEntries`
        // SKIPS — so the squareness tests above would pass over it.
        await expect(
            generateIcons({
                sourcePng: await squareMaster(1024),
                outDir,
                importer: await codecBadAt(64, Buffer.from('not a png at all, but bytes')),
            }),
        ).rejects.toThrow(/the 64px render is not a PNG/u);
    });

    it('writes nothing when a render fails its self-check', async () => {
        // The refusal has to happen before any output exists. Every size is
        // rendered up front precisely so a bad one cannot leave a half-written set
        // on disk — asserted on a directory that does not already exist, since
        // `outDir` is created by the fixture.
        const nested = path.join(outDir, 'nested', 'icons');

        await expect(
            generateIcons({
                sourcePng: await squareMaster(1024),
                outDir: nested,
                importer: await codecBadAt(16, await pngOf(16, 15)),
            }),
        ).rejects.toThrow(/the 16px render came out 16×15/u);

        await expect(stat(nested)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('pads a non-square master with transparency, not with opaque black', async () => {
        // `fit: 'contain'` letterboxes rather than crops, and sharp's DEFAULT pad
        // is opaque black — so dropping the explicit background silently puts
        // black bars down two edges of every icon of any game whose logo is not
        // square. Nothing else in the suite can see it: the bars are square, the
        // right size, and a perfectly valid PNG.
        await generateFromMaster(1024, 512);

        const { data, info } = await sharp(path.join(outDir, `${DEFAULT_ICON_BASENAME}-256.png`))
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Top-left is pad for a wide master: the image is centred vertically, so
        // the first row is above the content.
        expect(info.channels).toBe(4);
        expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
        // The centre still carries the master's colour — the negative control that
        // separates "padded transparent" from "wrote an empty image".
        const centre = (128 * info.width + 128) * info.channels;
        expect([...data.subarray(centre, centre + 4)]).toEqual([255, 80, 0, 255]);
    });
});

/** Big-endian `width`/`height` out of a PNG's IHDR — bytes 16 and 20 of the file. */
function pngDimensions(png: Buffer): { width: number; height: number } {
    if (png.byteLength < 24 || png.readUInt32BE(0) !== 0x8950_4e47) {
        throw new Error('not a PNG payload');
    }
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Every chunk type in an `.icns`, in file order, whatever its payload — the raw
 * walk `icnsPngEntries` filters. Separate because the filter is what makes an
 * unexpected chunk invisible, so the count has to come from before it.
 */
function icnsChunkSlots(icns: Buffer): readonly string[] {
    if (icns.subarray(0, 4).toString('ascii') !== 'icns') throw new Error('not an .icns');
    const slots: string[] = [];
    for (let offset = 8; offset + 8 <= icns.byteLength; ) {
        const length = icns.readUInt32BE(offset + 4);
        if (length < 8 || offset + length > icns.byteLength) {
            throw new Error(`.icns chunk at ${offset} has an out-of-range length ${length}`);
        }
        slots.push(icns.subarray(offset, offset + 4).toString('ascii'));
        offset += length;
    }
    return slots;
}

/**
 * Every PNG-carrying chunk of an `.icns`. Chunks with raw (non-PNG) payloads are
 * skipped rather than rejected — the legacy `is32`/`s8mk` forms are uncompressed
 * masks, and they carry no header to disagree with. That skip is why
 * `icnsChunkSlots` exists: this function alone cannot see a chunk it dropped.
 */
function icnsPngEntries(icns: Buffer): readonly ContainerEntry[] {
    if (icns.subarray(0, 4).toString('ascii') !== 'icns') throw new Error('not an .icns');
    const declaredLength = icns.readUInt32BE(4);
    if (declaredLength !== icns.byteLength) {
        throw new Error(`.icns length field ${declaredLength} != file ${icns.byteLength}`);
    }

    const entries: ContainerEntry[] = [];
    for (let offset = 8; offset + 8 <= icns.byteLength; ) {
        const slot = icns.subarray(offset, offset + 4).toString('ascii');
        const length = icns.readUInt32BE(offset + 4);
        if (length < 8 || offset + length > icns.byteLength) {
            throw new Error(`.icns chunk '${slot}' has an out-of-range length ${length}`);
        }
        const payload = icns.subarray(offset + 8, offset + length);
        if (payload.byteLength >= 24 && payload.readUInt32BE(0) === 0x8950_4e47) {
            entries.push({ slot, declared: null, ...pngDimensions(payload) });
        }
        offset += length;
    }
    return entries;
}

/**
 * One `bWidth`/`bHeight` byte of an ICO directory entry. 256 is the one size the
 * single-byte field cannot hold and is stored as 0 — so this is deliberately not a
 * `??` fallback, which would leave a real 0 meaning 0 and silently read every
 * 256×256 entry as absent.
 */
function icoDimension(byte: number | undefined): number {
    if (byte === undefined) throw new Error('.ico directory entry is truncated');
    return byte === 0 ? 256 : byte;
}

/** Every directory entry of an `.ico`, paired with its payload's own dimensions. */
function icoEntries(ico: Buffer): readonly ContainerEntry[] {
    if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('not an .ico');
    const count = ico.readUInt16LE(4);

    return Array.from({ length: count }, (_unused, index) => {
        const at = 6 + index * 16;
        const declared = { width: icoDimension(ico[at]), height: icoDimension(ico[at + 1]) };
        const byteLength = ico.readUInt32LE(at + 8);
        const imageOffset = ico.readUInt32LE(at + 12);
        if (imageOffset + byteLength > ico.byteLength) {
            throw new Error(`.ico entry ${index} points past the end of the file`);
        }
        const payload = ico.subarray(imageOffset, imageOffset + byteLength);
        return { slot: String(index), declared, ...pngDimensions(payload) };
    });
}

/** Collects everything written to stderr until `restore()`. */
function captureStderr(): { text: () => string; restore: () => void } {
    const chunks: string[] = [];
    const spy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
            chunks.push(String(chunk));
            return true;
        });
    return { text: () => chunks.join(''), restore: () => spy.mockRestore() };
}

describe('runGenerateIconsCli', () => {
    let cwd: string;

    beforeEach(async () => {
        cwd = await mkdtemp(path.join(tmpdir(), 'chimera-icons-cwd-'));
    });

    afterEach(async () => {
        await rm(cwd, { recursive: true, force: true });
    });

    it('resolves both engine-relative defaults against the root it is given', async () => {
        // Only the RULE, driven with a synthetic root so the assertion says
        // nothing about this checkout. That the CLI feeds it cwd rather than its
        // own location is a different claim, and only a run of the built bin can
        // carry it — see `bin.test.ts`.
        const { source, out } = parseCliArgs([], cwd);
        expect(source).toBe(path.join(cwd, DEFAULT_SOURCE_REL));
        expect(out).toBe(path.join(cwd, DEFAULT_OUT_REL));
    });

    it('refuses, naming both flags, when no master exists at the default path', async () => {
        // Running the bin bare from a game lands on an engine-relative default
        // the game has never had. An unexplained ENOENT on a path the caller did
        // not choose is the failure this replaces.
        const stderr = captureStderr();
        try {
            await expect(runGenerateIconsCli([], cwd)).resolves.toBe(1);
        } finally {
            stderr.restore();
        }

        expect(stderr.text()).toContain(path.join(cwd, DEFAULT_SOURCE_REL));
        expect(stderr.text()).toContain('--source');
        expect(stderr.text()).toContain('--out');
    });

    it('does NOT repeat the flags back at a caller who passed them', async () => {
        // Same guard, different caller: the refusal fires for any unresolvable
        // source, including one named explicitly. Telling someone who wrote
        // `--source` to write `--source` is noise on top of their typo, and it
        // buries the one thing they need — the path that did not resolve.
        const stderr = captureStderr();
        try {
            await expect(
                runGenerateIconsCli(['--source', path.join(cwd, 'typo.png')], cwd),
            ).resolves.toBe(1);
        } finally {
            stderr.restore();
        }

        expect(stderr.text()).toContain(path.join(cwd, 'typo.png'));
        expect(stderr.text()).not.toContain('--source');
        expect(stderr.text()).not.toContain('--out');
    });

    it('still advises the flags when some OTHER flag was passed but not --source', async () => {
        // `--out`-only is a natural invocation — an author who knows where the
        // set should land but has not supplied a master yet — and it is squarely
        // the case the advice exists for, since they did not choose the source
        // path. Covered explicitly because the two cases above are the extremes:
        // between them, `sourceFromFlag` set by the wrong branch is invisible.
        const stderr = captureStderr();
        try {
            await expect(
                runGenerateIconsCli(['--out', path.join(cwd, 'icons')], cwd),
            ).resolves.toBe(1);
        } finally {
            stderr.restore();
        }

        expect(stderr.text()).toContain(path.join(cwd, DEFAULT_SOURCE_REL));
        expect(stderr.text()).toContain('--source');
    });

    it('reports the source as flag-supplied only for --source', () => {
        // The field the branch above reads, asserted directly: the CLI test can
        // only see it through the advice line, which conflates "not set" with
        // "set by the wrong flag" whenever both produce the same output.
        expect(parseCliArgs([], cwd).sourceFromFlag).toBe(false);
        expect(parseCliArgs(['--out', 'x'], cwd).sourceFromFlag).toBe(false);
        expect(parseCliArgs(['--source', 'x'], cwd).sourceFromFlag).toBe(true);
    });

    it('writes the set and reports success when the master resolves', async () => {
        const master = path.join(cwd, 'master.png');
        await sharp({
            create: { width: 512, height: 512, channels: 4, background: { r: 9, g: 9, b: 9 } },
        })
            .png()
            .toFile(master);
        const outDir = path.join(cwd, 'icons');

        await expect(runGenerateIconsCli(['--source', master, '--out', outDir], cwd)).resolves.toBe(
            0,
        );
        await expect(
            stat(path.join(outDir, `${DEFAULT_ICON_BASENAME}.png`)),
        ).resolves.toBeDefined();
    });

    it('reports what it wrote, and where, relative to the root it was given', async () => {
        // The only user-visible output of a successful run. Unasserted, the
        // count, either path and the `[generate-icons]` prefix are all free to
        // drift — and the count is the one number a reader uses to tell a real
        // run from a guard that no-opped.
        const master = path.join(cwd, 'master.png');
        await sharp({
            create: { width: 256, height: 256, channels: 4, background: { r: 4, g: 5, b: 6 } },
        })
            .png()
            .toFile(master);
        const outDir = path.join(cwd, 'icons');

        const logged: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logged.push(args.map(String).join(' '));
        });
        try {
            await expect(
                runGenerateIconsCli(['--source', master, '--out', outDir], cwd),
            ).resolves.toBe(0);
        } finally {
            log.mockRestore();
        }

        expect(logged.join('\n')).toBe(
            '[generate-icons] Wrote 11 files to icons/ from master.png.',
        );
    });
});

/** Restates the production set — see `MODULE_NOT_FOUND_CODES` in `index.ts`. */
const MODULE_NOT_FOUND_CODES = ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'] as const;

/** What node throws for an unresolvable bare specifier. */
function missingModule(
    specifier: string,
    code: string = MODULE_NOT_FOUND_CODES[0],
): Error & { code: string } {
    return Object.assign(new Error(`Cannot find package '${specifier}'`), { code });
}

/**
 * Covers the on-demand codec load: that it stays on demand, that both interop
 * shapes resolve, and that every way it can fail says what to do. The rationale
 * for loading on demand at all lives on `loadImageCodec`.
 */
describe('loadImageCodec', () => {
    /** A resolved sharp: CJS `module.exports = fn`, so ESM sees it as `default`. */
    const sharpModule = { default: () => undefined };

    function importerFor(modules: Readonly<Record<string, unknown>>) {
        return (specifier: string): Promise<unknown> => {
            const resolved = modules[specifier];
            return resolved === undefined
                ? Promise.reject(missingModule(specifier))
                : Promise.resolve(resolved);
        };
    }

    it('names the codec and the one-time install command', () => {
        // Asserted on the constant itself, not on a thrown message: the text IS
        // the deliverable — it is what a game author sees, and the only thing
        // standing between them and a bare ERR_MODULE_NOT_FOUND.
        expect(MISSING_CODEC_MESSAGE).toContain('sharp');
        expect(MISSING_CODEC_MESSAGE).toContain('pnpm add -D sharp');
        // The containers are assembled here now, so nothing is left to advise a
        // second install for. Pinned because the reverse — advice naming a package
        // this tool no longer uses — sends a reader to install something that
        // changes nothing, which is the failure the whole message exists to avoid.
        expect(MISSING_CODEC_MESSAGE).not.toContain('png2icons');
    });

    it.each(MODULE_NOT_FOUND_CODES)(
        'rejects with the actionable message on %s, keeping the cause',
        async (code) => {
            // Parametrised over both codes because recognising only one sends the
            // other down the "could not be loaded" branch, which says nothing
            // about installing the thing that is missing. The cause is asserted
            // because it is all that survives the translation into the install
            // message.
            const importer = (specifier: string): Promise<unknown> =>
                Promise.reject(missingModule(specifier, code));

            await expect(loadImageCodec(importer)).rejects.toThrow(MISSING_CODEC_MESSAGE);
            await expect(loadImageCodec(importer)).rejects.toMatchObject({ cause: { code } });
        },
    );

    it('does NOT advise installing a codec whose import failed for another reason', async () => {
        // sharp ships prebuilt native bindings, and a platform or Node-ABI
        // mismatch fails the import of a package that is present — with no
        // `code`, since sharp's loader composes its own message. "Install it as a
        // devDependency" is a road with nothing at the end of it for that reader,
        // so the two cases must not share a message.
        const nativeFailure = new Error(
            'Could not load the sharp module using the darwin-arm64 runtime',
        );
        const rejects = loadImageCodec(() => Promise.reject(nativeFailure));

        await expect(rejects).rejects.toThrow(/'sharp' could not be loaded/u);
        await expect(rejects).rejects.not.toThrow(/pnpm add -D/u);
        await expect(rejects).rejects.toMatchObject({ cause: nativeFailure });
    });

    it('claims nothing about the install when the rejection carries no code', async () => {
        // Reachable through the public `importer`, and through any loader that
        // reports absence codelessly. Whatever happened, the headline must not
        // assert a filesystem fact it did not check — `cause` carries the truth.
        const codeless = new Error('something failed, and said nothing about what');
        const rejects = loadImageCodec(() => Promise.reject(codeless));

        await expect(rejects).rejects.toThrow(/'sharp' could not be loaded/u);
        await expect(rejects).rejects.not.toThrow(/installed/u);
        await expect(rejects).rejects.toMatchObject({ cause: codeless });
    });

    it('survives a rejection that is not an Error at all', async () => {
        // The `code` read has to be nullish-safe against a non-object too: a
        // custom `importer` is public API, and `('str').code` on an unguarded
        // read is the same class of opaque TypeError the unwrappers were
        // hardened against.
        // @chimera-review: rejecting with a non-Error IS the case under test.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        const rejects = loadImageCodec(() => Promise.reject('not even an Error'));

        await expect(rejects).rejects.toThrow(/'sharp' could not be loaded/u);
        await expect(rejects).rejects.toMatchObject({ cause: 'not even an Error' });
    });

    it('unwraps sharp from the CJS default slot', async () => {
        const codec = await loadImageCodec(importerFor({ sharp: sharpModule }));
        expect(codec).toBe(sharpModule.default);
    });

    it('accepts sharp delivered as the bare function, without a default slot', async () => {
        // tsx's CJS transform hands back `module.exports` itself rather than an
        // interop namespace, so the same source must survive both shapes.
        const bareSharp = () => undefined;
        const codec = await loadImageCodec(importerFor({ sharp: bareSharp }));
        expect(codec).toBe(bareSharp);
    });

    it('names the codec when it resolves to something it cannot drive', async () => {
        // Naming it is the whole reason the check exists — a message that said
        // only "a codec is unusable" would be indistinguishable from the
        // missing-install case both to a reader and to this assertion.
        await expect(
            loadImageCodec(importerFor({ sharp: { default: 'not a function' } })),
        ).rejects.toThrow(/'sharp' resolved but is not callable/u);
    });

    it('reports rather than throws a TypeError when the codec resolves to nothing', async () => {
        // `importer` is public, so a loader handing back null reaches the
        // unwrapper. Reading `.default` off it unguarded yields "cannot read
        // properties of null" — the opaque failure this whole path exists to
        // prevent, produced by the code meant to prevent it.
        for (const empty of [null, undefined]) {
            await expect(loadImageCodec(() => Promise.resolve(empty))).rejects.toThrow(
                /'sharp' resolved but is not callable/u,
            );
        }
    });

    it('resolves the real codec through a real dynamic import', async () => {
        // The fakes above pin the unwrap logic; only this pins that the unwrap
        // matches what the REAL package actually delivers under this loader.
        expect(typeof (await loadImageCodec())).toBe('function');
    });

    it('is the only route to the codec — it is never loaded eagerly', async () => {
        // A property of the module GRAPH, which no value a test can read
        // exposes: with the codec statically imported every assertion above still
        // passes, in a checkout that has it installed.
        const source = await readFile(
            fileURLToPath(new URL('./index.ts', import.meta.url)),
            'utf8',
        );
        const eager = eagerLoadsOf(source);

        // Positive first, and against the REAL file: `createSourceFile` recovers
        // from a syntax error by dropping statements, so an empty result is
        // indistinguishable from a clean one — the negative below would pass over
        // a source that was never parsed at all.
        expect(eager).toContain('node:fs/promises');

        expect(eager).not.toContain('sharp');
    });

    it('detects every eager-load form, and no deferred or erased one', () => {
        // The negative control the scan above cannot carry itself: a typo inside
        // `eagerLoadsOf` would make it return nothing and green the guard over a
        // module that DOES load a codec. Same shape as the
        // `verify:publish --self-test` gate — the check proves it bites on the
        // same run it is trusted on.
        for (const hazard of [
            "import 'sharp';", // bare side-effect — throws at load, binds nothing
            "import sharp from 'sharp';",
            "import * as sharp from 'sharp';",
            "import { cache } from 'sharp';",
            "import sharp, { type Sharp } from 'sharp';", // default binding survives
            "export { cache } from 'sharp';",
            "export * from 'sharp';",
            // Not import syntax at all, and every bit as eager. `require` is not
            // defined in an ES module, but `createRequire` is the documented way
            // back into CJS and runs at module top just the same.
            "const sharp = require('sharp');",
            "const sharp = createRequire(import.meta.url)('sharp');",
            "import sharp = require('sharp');",
        ]) {
            expect(eagerLoadsOf(hazard), hazard).toContain('sharp');
        }

        // Erased or deferred: none of these puts the codec in the module graph.
        for (const safe of [
            "import type Sharp from 'sharp';",
            "import type * as Sharp from 'sharp';",
            "export type { Sharp } from 'sharp';",
            // Inline-type — fully erased, and the form `eslint --fix` writes under
            // this repo's `fixStyle: 'inline-type-imports'`. Flagging it would red
            // on erased code and invite the next reader to weaken the guard.
            "import { type Sharp } from 'sharp';",
            "import { type Sharp, type Metadata } from 'sharp';",
            "export { type Sharp } from 'sharp';",
            "const s = await import('sharp');",
            'const s = await import(specifier);',
        ]) {
            expect(eagerLoadsOf(safe), safe).not.toContain('sharp');
        }
    });

    it('documents where the require-shaped heuristic misses, and where it over-reaches', () => {
        // Recorded as tests, not as a comment, so the boundary is inherited
        // rather than rediscovered — and so it reds the day someone closes one
        // of these, rather than silently over-covering. All three DO load the
        // codec; none is matched, because matching is on the callee's text.
        for (const escapes of [
            "const req = createRequire(import.meta.url);\nconst s = req('sharp');",
            "const s = module.require('sharp');",
            "const s = globalThis.require('sharp');",
        ]) {
            expect(eagerLoadsOf(escapes), escapes).not.toContain('sharp');
        }

        // And where it over-reaches: a deferred require is reported as though it
        // were eager. Harmless here — this module has no business reaching CJS
        // at any time — but it is a false positive, not a detection.
        for (const deferred of [
            "function load() { return require('sharp'); }",
            "async function load() { return createRequire(import.meta.url)('sharp'); }",
        ]) {
            expect(eagerLoadsOf(deferred), deferred).toContain('sharp');
        }
    });
});

/**
 * The packages `source` pulls in outside a dynamic `import()`. Two checks, of
 * deliberately different strength — see each below. Both parse rather than
 * pattern-match, because a guard written around import SYNTAX has to enumerate
 * binding forms and the one it forgets is the one that ships.
 */
function eagerLoadsOf(source: string): readonly string[] {
    const parsed = createSourceFile('probe.ts', source, ScriptTarget.ESNext, true, ScriptKind.TS);
    return [...declaredImportsOf(parsed), ...requireShapedCallsIn(parsed)];
}

/**
 * Every package `source` imports through a DECLARATION — exact, not heuristic.
 * Import and export declarations may only appear at a module's top level, so
 * every one of these loads before the module finishes loading.
 *
 * What is absent is absent by construction: type-only imports in either
 * spelling are erased before they reach a module graph, and dynamic `import()`
 * is not a declaration at all — it is the mechanism under test.
 */
function declaredImportsOf(parsed: SourceFile): readonly string[] {
    return parsed.statements.flatMap((statement) => {
        if (isImportDeclaration(statement)) {
            return isErasedImport(statement) ? [] : specifierTextOf(statement.moduleSpecifier);
        }
        if (isExportDeclaration(statement)) {
            return isErasedExport(statement) ? [] : specifierTextOf(statement.moduleSpecifier);
        }
        if (isImportEqualsDeclaration(statement)) {
            const reference = statement.moduleReference;
            return isExternalModuleReference(reference)
                ? specifierTextOf(reference.expression)
                : [];
        }
        return [];
    });
}

/**
 * Every package named by a `require`-SHAPED call, anywhere in the file. A
 * deliberately conservative name-based heuristic, and NOT a proof in either
 * direction:
 *
 *   - it over-reports — a `require` inside a function body is deferred, not
 *     eager, and is still listed. That is the trade this module can afford:
 *     nothing here has any business reaching CJS at all, so the false positive
 *     is a conversation rather than a defect;
 *   - it under-reports — matching is on the callee's TEXT, so
 *     `const req = createRequire(url); req('sharp')`, `module.require('sharp')`
 *     and `globalThis.require('sharp')` all escape. The control test lists
 *     these as known non-coverage rather than leaving the next reader to
 *     rediscover them.
 *
 * The load-bearing guarantee is `declaredImportsOf`; this is a second net under
 * it, not a substitute.
 */
function requireShapedCallsIn(parsed: SourceFile): readonly string[] {
    const required: string[] = [];
    const visit = (node: Node): void => {
        if (isCallExpression(node) && isRequireLike(node.expression)) {
            required.push(...specifierTextOf(node.arguments[0]));
        }
        forEachChild(node, visit);
    };
    forEachChild(parsed, visit);
    return required;
}

/**
 * Whether an import declaration is erased entirely. True for the `import type`
 * prefix, and equally for `import { type A, type B }` — which is what
 * `eslint --fix` writes under this repo's `fixStyle: 'inline-type-imports'`. A
 * default or namespace binding alongside them survives, so only a named clause
 * whose every element is type-only counts.
 */
function isErasedImport(node: ImportDeclaration): boolean {
    const clause = node.importClause;
    if (clause === undefined) return false; // `import 'sharp';` — binds nothing, loads it
    if (clause.isTypeOnly) return true;
    if (clause.name !== undefined) return false;
    const bindings = clause.namedBindings;
    return (
        bindings !== undefined &&
        isNamedImports(bindings) &&
        bindings.elements.every((element) => element.isTypeOnly)
    );
}

/** The `export { … } from` mirror of `isErasedImport`. */
function isErasedExport(node: ExportDeclaration): boolean {
    if (node.isTypeOnly) return true;
    const clause = node.exportClause;
    return (
        clause !== undefined &&
        isNamedExports(clause) &&
        clause.elements.every((element) => element.isTypeOnly)
    );
}

/** `require(…)` itself, or the `createRequire(…)(…)` route back into CJS. */
function isRequireLike(expression: Expression): boolean {
    if (isIdentifier(expression)) return expression.text === 'require';
    return (
        isCallExpression(expression) &&
        isIdentifier(expression.expression) &&
        expression.expression.text === 'createRequire'
    );
}

/** The literal text of a module specifier; a computed one names no package. */
function specifierTextOf(specifier: Expression | undefined): readonly string[] {
    return specifier !== undefined && isStringLiteral(specifier) ? [specifier.text] : [];
}
