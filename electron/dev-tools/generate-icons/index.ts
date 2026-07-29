#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDirectInvocation } from '../dev-harness/harness.js';
// TYPE-only, and load-bearing that it stays that way: type imports are erased, so
// this describes the codec without putting it in this module's runtime graph.
import type SharpFactory from 'sharp';

/**
 * Deterministic platform icon-set generator for the Chimera engine.
 *
 * Derives the application/window icon set from a single square master logo PNG and
 * writes the canonical set into one directory consumed by two later layers:
 *   - the dev-runtime default (`chimera.png`, 512×512) resolved in
 *     `@chimera-engine/electron`'s `createMainWindow`, and
 *   - the build icon set (`chimera.icns` / `chimera.ico` + loose Linux PNG sizes)
 *     wired into the packaging config.
 *
 * EVERY image in the set — the loose PNGs and every image inside the two containers
 * alike — is an exact-size square render produced by `sharp` (libvips) directly from
 * the master. The containers are then assembled here, byte by byte, around those
 * renders; nothing downstream resizes anything.
 *
 * That is a correctness requirement, not a preference. The previous implementation
 * handed the whole master to a container library and let it resize internally, which
 * cost the set twice over:
 *   - it derived each output height as `floor(srcHeight * (target / srcWidth))`. For
 *     some master widths that double round-trip lands a hair BELOW the integer and
 *     the floor drops a pixel; for most it does not, and which target sizes are hit
 *     is a property of the individual width. Measured over the widths 256–2048 and
 *     this tool's ten target sizes, 292 of 1793 widths lose at least one — and the
 *     engine's master, at 1825, is one of them: `32 / 1825 * 1825` is
 *     `31.999999999999996`, and every power-of-two target from 16 to 1024 came out
 *     one pixel short in height. The shell stretches those back to square, and
 *     `.ico`'s largest entry (256×255) fell under electron-builder's 256×256
 *     minimum and failed the Windows build outright;
 *   - it decimated a 1825px master to 16–64px in a single bicubic step with no
 *     low-pass prefilter, which aliases hard and blows isolated pixels out at
 *     high-contrast edges. libvips shrink-then-Lanczos does not.
 *
 * `sharp` is an optional peer dependency loaded on demand — see `loadImageCodec`.
 *
 * This module is emitted into the package's `dist/` and therefore travels inside the
 * published tarball, but nothing in a game's runtime graph reaches it.
 *
 * Regenerate (one-liner): `pnpm icons:generate`
 *
 * CLI, in the monorepo and as the published bin:
 *   tsx electron/dev-tools/generate-icons/index.ts [--source <master.png>] [--out <dir>]
 *   chimera-generate-icons [--source <master.png>] [--out <dir>]
 *
 * Defaults: source `docs/assets/chimera-logo-compact.png`, out `electron/assets/icons`
 * — see `runGenerateIconsCli` for what they resolve against.
 */

/** Loose square PNG sizes emitted alongside the `.icns`/`.ico` containers. */
export const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024] as const;

/** Base filename stem shared by every generated asset (`chimera.icns`, `chimera-256.png`, …). */
export const DEFAULT_ICON_BASENAME = 'chimera';

/**
 * Size used for the dev-runtime default `chimera.png` — the stable filename passed
 * to `createMainWindow({ icon })`. 512px reads well as a BrowserWindow icon on
 * Windows/Linux and as the macOS dock icon.
 */
export const DEFAULT_RUNTIME_ICON_SIZE = 512;

/** Repo-relative location of the master logo the CLI reads by default. */
export const DEFAULT_SOURCE_REL = 'docs/assets/chimera-logo-compact.png';

/** Repo-relative directory the CLI writes the canonical set into by default. */
export const DEFAULT_OUT_REL = 'electron/assets/icons';

/**
 * The `.icns` chunk table: OSType slot → pixel size, every payload a PNG.
 *
 * This is exactly the set electron-builder's own `app-builder` generator emits, and
 * it is a deliberately narrow slice of what the format allows. Two neighbouring
 * slots are wrong in ways that are invisible until a user looks at the Dock:
 *   - `ic04`/`ic05` (16/32) are raw `ARGB`, NOT PNG. macOS has two decoders and they
 *     disagree — `NSImage` reads a PNG there happily, while IconServices, the path
 *     Finder and the Dock actually use, rejects it and falls back to the generic
 *     application icon. Omitting them costs nothing on a Retina display, where 16pt
 *     and 32pt render from `ic11`/`ic12` anyway; getting their format wrong costs
 *     the whole icon.
 *   - `icp4`/`icp5` with PNG payloads are decoded as raw bytes and render as noise.
 *
 * The 256/512 sizes appear twice on purpose: `ic08`/`ic09` are the @1x slots and
 * `ic13`/`ic14` the @2x slots of the size below them. The bytes are identical, so
 * both reference the same render.
 */
export const ICNS_SLOTS = [
    ['ic10', 1024],
    ['ic14', 512],
    ['ic09', 512],
    ['ic13', 256],
    ['ic08', 256],
    ['ic07', 128],
    ['ic12', 64],
    ['ic11', 32],
] as const satisfies readonly (readonly [string, number])[];

/**
 * Sizes carried by the `.ico`, largest first — the conventional Windows shell ladder
 * (16 list view, 24 legacy, 32 small, 48 medium, 96 extra-large, 256 jumbo) plus 64
 * and 128 as intermediate rungs.
 *
 * 256 is not optional: electron-builder validates `win.icon` through its `app-builder`
 * binary and rejects anything whose largest entry is under 256×256 with
 * `ERR_ICON_TOO_SMALL`, which is a hard build failure rather than a warning.
 */
export const ICO_SIZES = [256, 128, 96, 64, 48, 32, 24, 16] as const;

/** Resolves a bare module specifier — the seam the codec load is driven through. */
export type ModuleImporter = (specifier: string) => Promise<unknown>;

/**
 * What a run says when the codec is not installed — the deliverable of the optional-peer
 * contract. Absent it, a game author regenerating icons for the first time gets a bare
 * `ERR_MODULE_NOT_FOUND` naming a package they never asked for.
 *
 * Reserved for a genuinely-absent codec. An installed-but-broken one gets a different
 * message: telling someone to install what they already have is worse than useless.
 */
export const MISSING_CODEC_MESSAGE =
    'generate-icons: sharp is required to generate icons and is an optional peer ' +
    'dependency. Install it as a devDependency: pnpm add -D sharp';

/** Node's two codes for "no such module", across the ESM and CJS resolvers. */
const MODULE_NOT_FOUND_CODES: ReadonlySet<string> = new Set([
    'ERR_MODULE_NOT_FOUND',
    'MODULE_NOT_FOUND',
]);

/**
 * Load the codec on demand.
 *
 * It is deliberately NOT a module-top import. `sharp` is a multi-megabyte
 * platform-specific native binary, and an optional peer precisely so a game that never
 * regenerates its icons never installs it — but a static import would throw at MODULE
 * LOAD in exactly that install, before any message could be printed. Loading here,
 * inside the one path that needs it, is what makes the failure explainable.
 *
 * `sharp` is CJS `module.exports = fn`, so ESM presents the function under `default`
 * while a CJS transform hands back the function itself. Both are accepted, since which
 * one a loader produces is a property of the loader, not of this tool — and the
 * `default` read silently yields `undefined` rather than failing under the other shape.
 */
export async function loadImageCodec(
    importer: ModuleImporter = (specifier) => import(specifier),
): Promise<typeof SharpFactory> {
    return unwrapSharp(await importCodec(importer, 'sharp'));
}

/**
 * Import the codec, separating "not installed" from "installed but will not load".
 *
 * The split matters: `sharp` ships prebuilt native bindings, and a platform or Node-ABI
 * mismatch fails the import of a package that IS present. Answering that with "install
 * it as a devDependency" sends the reader down a road with nothing at the end of it.
 * Either way the original error is kept as `cause`, so nothing is lost.
 */
async function importCodec(importer: ModuleImporter, specifier: string): Promise<unknown> {
    try {
        return await importer(specifier);
    } catch (error: unknown) {
        const code = (error as { code?: unknown } | null | undefined)?.code;
        if (typeof code === 'string' && MODULE_NOT_FOUND_CODES.has(code)) {
            throw new Error(MISSING_CODEC_MESSAGE, { cause: error });
        }
        // Deliberately says nothing about whether the package is on disk: a
        // rejection carrying no `code` — a non-Error rejection through the public
        // `importer`, or a loader that reports absence codelessly — would make any
        // claim about the install a guess printed as a fact.
        throw new Error(
            `generate-icons: '${specifier}' could not be loaded — see this error's cause for ` +
                `the underlying failure.`,
            { cause: error },
        );
    }
}

function unwrapSharp(module: unknown): typeof SharpFactory {
    // Optional chaining, not a plain property read: `importer` is part of the public
    // options, so a loader handing back `null` reaches here, and a raw
    // "cannot read properties of null" is the opaque failure this path exists to
    // prevent.
    const candidate = (module as { default?: unknown } | null | undefined)?.default ?? module;
    if (typeof candidate !== 'function') {
        // Names the codec and what it lacked, because the alternative is a
        // `TypeError` thrown from inside the render loop with a half-written icon
        // set already on disk.
        throw new Error(
            `generate-icons: 'sharp' resolved but is not callable. An incompatible version is ` +
                `the likely cause.`,
        );
    }
    return candidate as typeof SharpFactory;
}

export interface GenerateIconsOptions {
    /** Absolute path to the square master logo PNG. */
    readonly sourcePng: string;
    /** Absolute output directory; created if missing. */
    readonly outDir: string;
    /**
     * Overrides how the image codec is resolved. Defaults to a real dynamic import;
     * supplying one substitutes the module resolution itself, which is the only way to
     * reach the codec-absent path from an environment that has it installed.
     */
    readonly importer?: ModuleImporter;
}

export interface GenerateIconsResult {
    /** Filenames written into `outDir`, sorted. */
    readonly written: readonly string[];
}

/** Every distinct pixel size some part of the set needs, largest first. */
const RENDER_SIZES: readonly number[] = [
    ...new Set<number>([...PNG_SIZES, ...ICO_SIZES, ...ICNS_SLOTS.map(([, size]) => size)]),
].sort((left, right) => right - left);

/**
 * Generate the platform icon set from `sourcePng` into `outDir`. Returns the written
 * filenames (sorted). The function is pure with respect to its inputs — it only reads
 * the master and writes into the given directory — so it is safe to drive from tests
 * against a temp dir.
 */
export async function generateIcons(options: GenerateIconsOptions): Promise<GenerateIconsResult> {
    const { sourcePng, outDir, importer } = options;

    // An absent codec, an unreadable master and an undecodable one all resolve
    // before the mkdir, so none leaves an empty directory behind as evidence that it
    // tried. The decode used to sit inside the write loop, past the point of no
    // output; rendering every size up front moved it in front of the mkdir, so the
    // undecodable case now fails as cleanly as the other two.
    const sharp = await loadImageCodec(importer);
    const master = await readFile(sourcePng);

    // Every size rendered once, up front, and reused by whichever outputs need it:
    // the two containers overlap the loose sizes and each other, and re-rendering
    // per consumer would make "the 256 in the .ico" and "the 256 in the .icns"
    // separately capable of being wrong.
    const renders = new Map<number, Buffer>();
    for (const size of RENDER_SIZES) {
        renders.set(size, await renderSquare(sharp, master, size));
    }

    await mkdir(outDir, { recursive: true });
    const written: string[] = [];

    const write = async (name: string, data: Buffer): Promise<void> => {
        await writeFile(path.join(outDir, name), data);
        written.push(name);
    };

    for (const size of PNG_SIZES) {
        const png = renderOf(renders, size);
        await write(`${DEFAULT_ICON_BASENAME}-${size}.png`, png);
        // The dev-runtime default reuses the 512px render under a stable, size-less name.
        if (size === DEFAULT_RUNTIME_ICON_SIZE) {
            await write(`${DEFAULT_ICON_BASENAME}.png`, png);
        }
    }

    await write(`${DEFAULT_ICON_BASENAME}.icns`, buildIcns(renders));
    await write(`${DEFAULT_ICON_BASENAME}.ico`, buildIco(renders));

    return { written: [...written].sort() };
}

/**
 * One exact-size square PNG, verified against its own header before it is used.
 *
 * The verification is not defensive padding — it is the guard for the defect class
 * this module exists to have fixed. An off-by-one in a resize is invisible in every
 * downstream byte: the container assembles happily around a 256×255 payload, writes a
 * well-formed file, and the shell stretches the result back to square at display time.
 * Reading the dimensions back out of the emitted PNG is the only step that can tell a
 * correct render from a plausible one, and it costs 24 bytes.
 *
 * `fit: 'contain'` pads a non-square master rather than cropping it, and the pad is
 * explicitly transparent: sharp's default background is OPAQUE BLACK, which would put
 * black letterbox bars into every icon of any game whose logo is not square.
 */
async function renderSquare(
    sharp: typeof SharpFactory,
    master: Buffer,
    size: number,
): Promise<Buffer> {
    const png = await sharp(master)
        .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();

    const rendered = pngDimensionsOf(png);
    if (rendered === null) {
        throw new Error(`generate-icons: the ${size}px render is not a PNG.`);
    }
    if (rendered.width !== size || rendered.height !== size) {
        throw new Error(
            `generate-icons: the ${size}px render came out ${rendered.width}×${rendered.height}. ` +
                `Every image in the set must be an exact square — a non-square one is stretched ` +
                `by the shell at display time, and an under-256 '.ico' entry fails the Windows build.`,
        );
    }
    return png;
}

/** The render for `size`, which `RENDER_SIZES` guarantees exists. */
function renderOf(renders: ReadonlyMap<number, Buffer>, size: number): Buffer {
    const png = renders.get(size);
    if (png === undefined) {
        throw new Error(`generate-icons: no ${size}px render — RENDER_SIZES is out of sync.`);
    }
    return png;
}

/** PNG magic, as the big-endian uint32 the first four bytes spell. */
const PNG_MAGIC = 0x8950_4e47;

/** A PNG's IHDR dimensions — big-endian uint32s at byte 16 and 20 — or `null`. */
function pngDimensionsOf(png: Buffer): { readonly width: number; readonly height: number } | null {
    if (png.byteLength < 24 || png.readUInt32BE(0) !== PNG_MAGIC) return null;
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Assemble the macOS `.icns`.
 *
 * Layout, all big-endian: the ASCII magic `icns`, a uint32 total file length that
 * INCLUDES its own 8-byte header, then chunks to EOF. Each chunk is a 4-byte ASCII
 * OSType, a uint32 length that likewise includes the chunk's own 8-byte header, and
 * the payload. No padding, no alignment, and no table of contents — `iconutil`
 * accepts a file without one, and chunk order carries no meaning.
 */
function buildIcns(renders: ReadonlyMap<number, Buffer>): Buffer {
    const chunks = ICNS_SLOTS.map(([slot, size]) => {
        const payload = renderOf(renders, size);
        const header = Buffer.alloc(8);
        header.write(slot, 0, 'ascii');
        header.writeUInt32BE(header.byteLength + payload.byteLength, 4);
        return Buffer.concat([header, payload]);
    });

    const fileHeader = Buffer.alloc(8);
    fileHeader.write('icns', 0, 'ascii');
    fileHeader.writeUInt32BE(
        chunks.reduce((total, chunk) => total + chunk.byteLength, fileHeader.byteLength),
        4,
    );
    return Buffer.concat([fileHeader, ...chunks]);
}

/** Bytes of the `ICONDIR` header, and of each `ICONDIRENTRY` that follows it. */
const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

/**
 * Assemble the Windows `.ico`.
 *
 * Layout, all little-endian: an `ICONDIR` of `idReserved` (0), `idType` (1 = icon) and
 * `idCount`, then one 16-byte `ICONDIRENTRY` per image, then the payloads. An entry
 * carries `bWidth`/`bHeight` as single bytes — which is why 256 is spelled `0`, the
 * one size the field cannot hold — followed by `bColorCount` (0, meaning ≥8bpp),
 * `bReserved` (0), `wPlanes` (1), `wBitCount` (32), and the payload's length and
 * absolute offset.
 *
 * Every payload is a PNG. Windows has read PNG-compressed entries since Vista; only
 * XP and earlier need BMP, and an Electron app does not run there.
 */
function buildIco(renders: ReadonlyMap<number, Buffer>): Buffer {
    const images = ICO_SIZES.map((size) => ({ size, payload: renderOf(renders, size) }));

    const header = Buffer.alloc(ICO_HEADER_BYTES);
    header.writeUInt16LE(0, 0); // idReserved
    header.writeUInt16LE(1, 2); // idType: 1 = icon
    header.writeUInt16LE(images.length, 4);

    let imageOffset = ICO_HEADER_BYTES + ICO_ENTRY_BYTES * images.length;

    const entries = images.map(({ size, payload }) => {
        const entry = Buffer.alloc(ICO_ENTRY_BYTES);
        // 256 does not fit a byte and is spelled 0; nothing else in the ladder is
        // affected, since every other size is under 256.
        entry.writeUInt8(size % 256, 0); // bWidth
        entry.writeUInt8(size % 256, 1); // bHeight
        entry.writeUInt8(0, 2); // bColorCount — 0 for ≥8bpp
        entry.writeUInt8(0, 3); // bReserved — must be 0
        entry.writeUInt16LE(1, 4); // wPlanes
        entry.writeUInt16LE(32, 6); // wBitCount
        entry.writeUInt32LE(payload.byteLength, 8); // dwBytesInRes
        entry.writeUInt32LE(imageOffset, 12); // dwImageOffset
        imageOffset += payload.byteLength;
        return entry;
    });

    return Buffer.concat([header, ...entries, ...images.map(({ payload }) => payload)]);
}

interface CliArgs {
    readonly source: string;
    readonly out: string;
    /** False when `source` came from the default rather than from `--source`. */
    readonly sourceFromFlag: boolean;
}

/** Parse `--source <path>` / `--out <dir>`, resolving defaults against `root`. */
export function parseCliArgs(argv: readonly string[], root: string): CliArgs {
    let source = path.join(root, DEFAULT_SOURCE_REL);
    let out = path.join(root, DEFAULT_OUT_REL);
    let sourceFromFlag = false;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === '--source' && next !== undefined) {
            source = path.resolve(next);
            sourceFromFlag = true;
            i += 1;
        } else if (arg === '--out' && next !== undefined) {
            out = path.resolve(next);
            i += 1;
        }
    }
    return { source, out, sourceFromFlag };
}

/**
 * Run the CLI. Returns the process exit code rather than exiting, so the entry below
 * owns every exit and a test can drive the whole thing in-process.
 *
 * `root` is the base the DEFAULT source and out paths resolve against — the current
 * working directory, never this module's location. That is the same choice
 * `validate-assets`, `fetch-google-fonts` and the dev-harness make, and here it is
 * load-bearing rather than stylistic: the engine-relative defaults land correctly from
 * the repo root, which is where `pnpm icons:generate` runs, whereas derived from the
 * module they would resolve relative to `dist/dev-tools/generate-icons/` in a published
 * install and point at paths no consumer has. Explicit `--source`/`--out` values are
 * resolved by `parseCliArgs` against the real process cwd, not against `root`.
 */
export async function runGenerateIconsCli(
    argv: readonly string[] = process.argv.slice(2),
    root: string = process.cwd(),
): Promise<number> {
    const { source, out, sourceFromFlag } = parseCliArgs(argv, root);

    if (!(await fileExists(source))) {
        process.stderr.write(`[generate-icons] No master logo at ${source}.\n`);
        // Only when the caller did NOT choose that path. Running the bin bare
        // from a game lands on an engine-relative default the game has never
        // had, and naming the flags is the fix; telling someone who passed
        // `--source` to pass `--source` is noise on top of their typo.
        if (!sourceFromFlag) {
            process.stderr.write(
                `[generate-icons] Pass the square master PNG and the output directory: ` +
                    `chimera-generate-icons --source <master.png> --out <dir>\n`,
            );
        }
        return 1;
    }

    const { written } = await generateIcons({ sourcePng: source, outDir: out });
    const relativeOut = path.relative(root, out) || out;
    const relativeSource = path.relative(root, source) || source;
    console.log(
        `[generate-icons] Wrote ${written.length} files to ${relativeOut}/ from ${relativeSource}.`,
    );
    return 0;
}

/**
 * Existence only. A master that is present but unreadable falls through to the read,
 * where the EACCES names the same path — a different fix from "there is nothing here",
 * and one this guard has no better answer for than the error already gives.
 */
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

// CLI entry, in the monorepo (`pnpm icons:generate`) and as the published
// `chimera-generate-icons` bin alike.
const invokedDirectly = isDirectInvocation(import.meta.url, process.argv[1]);
if (invokedDirectly) {
    runGenerateIconsCli()
        .then((exitCode) => process.exit(exitCode))
        .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`[generate-icons] ${message}\n`);
            process.exit(1);
        });
}
