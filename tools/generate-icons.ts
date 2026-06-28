import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// png2icons ships `__esModule: true` with named exports but no `default`, so a
// default import resolves to `undefined` under tsx's CJS transform — use a namespace.
import * as png2icons from 'png2icons';
import sharp from 'sharp';

/**
 * tools/generate-icons.ts
 *
 * F67 T1 (#811) — deterministic platform icon-set generator for the Chimera engine.
 *
 * Derives the application/window icon set from a single square master logo PNG and
 * writes the canonical set into one directory consumed by two later F67 layers:
 *   - the dev-runtime default (`chimera.png`, 512×512) resolved by F67 T2 in
 *     `@chimera-engine/electron`'s `createMainWindow`, and
 *   - the build icon set (`chimera.icns` / `chimera.ico` + loose Linux PNG sizes)
 *     wired into the packaging config by F67 T4.
 *
 * Loose PNGs are downscaled with `sharp` (libvips) for crisp small sizes; the
 * `.icns`/`.ico` containers are assembled with the pure-JS `png2icons`. Both are
 * dev-only tooling dependencies — nothing here ships at runtime.
 *
 * Regenerate (one-liner): `pnpm icons:generate`
 *
 * CLI (run via tsx — `tools/*.ts` transforms as CommonJS, so the entry is an async
 * IIFE with no top-level await):
 *   tsx tools/generate-icons.ts [--source <master.png>] [--out <dir>]
 *
 * Defaults: source `docs/assets/chimera-logo-compact.png`, out `electron/assets/icons`.
 */

/** Loose square PNG sizes emitted alongside the `.icns`/`.ico` containers. */
export const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024] as const;

/** Base filename stem shared by every generated asset (`chimera.icns`, `chimera-256.png`, …). */
export const DEFAULT_ICON_BASENAME = 'chimera';

/**
 * Size used for the dev-runtime default `chimera.png` — the stable filename F67 T2
 * passes to `createMainWindow({ icon })`. 512px reads well as a BrowserWindow icon
 * on Windows/Linux and as the macOS dock icon.
 */
export const DEFAULT_RUNTIME_ICON_SIZE = 512;

/** Repo-relative location of the master logo the CLI reads by default. */
export const DEFAULT_SOURCE_REL = 'docs/assets/chimera-logo-compact.png';

/** Repo-relative directory the CLI writes the canonical set into by default. */
export const DEFAULT_OUT_REL = 'electron/assets/icons';

export interface GenerateIconsOptions {
    /** Absolute path to the square master logo PNG. */
    readonly sourcePng: string;
    /** Absolute output directory; created if missing. */
    readonly outDir: string;
}

export interface GenerateIconsResult {
    /** Filenames written into `outDir`, sorted. */
    readonly written: readonly string[];
}

/**
 * Generate the platform icon set from `sourcePng` into `outDir`. Returns the written
 * filenames (sorted). The function is pure with respect to its inputs — it only reads
 * the master and writes into the given directory — so it is safe to drive from tests
 * against a temp dir.
 */
export async function generateIcons(options: GenerateIconsOptions): Promise<GenerateIconsResult> {
    const { sourcePng, outDir } = options;
    await mkdir(outDir, { recursive: true });

    const master = await readFile(sourcePng);
    const written: string[] = [];

    const write = async (name: string, data: Buffer | Uint8Array): Promise<void> => {
        await writeFile(path.join(outDir, name), data);
        written.push(name);
    };

    // Loose square PNGs, one per declared size, downscaled from the master with libvips.
    for (const size of PNG_SIZES) {
        const png = await sharp(master).resize(size, size, { fit: 'contain' }).png().toBuffer();
        await write(`${DEFAULT_ICON_BASENAME}-${size}.png`, png);
        // The dev-runtime default reuses the 512px render under a stable, size-less name.
        if (size === DEFAULT_RUNTIME_ICON_SIZE) {
            await write(`${DEFAULT_ICON_BASENAME}.png`, png);
        }
    }

    // Platform containers — png2icons resizes the master internally to every size each
    // format requires (returns null only on a malformed/undecodable input buffer).
    const icns = png2icons.createICNS(master, png2icons.BICUBIC2, 0);
    if (icns === null) {
        throw new Error(`Failed to build .icns from ${sourcePng} (undecodable PNG?)`);
    }
    await write(`${DEFAULT_ICON_BASENAME}.icns`, icns);

    const ico = png2icons.createICO(master, png2icons.BICUBIC2, 0, /* usePNG */ true);
    if (ico === null) {
        throw new Error(`Failed to build .ico from ${sourcePng} (undecodable PNG?)`);
    }
    await write(`${DEFAULT_ICON_BASENAME}.ico`, ico);

    return { written: [...written].sort() };
}

interface CliArgs {
    readonly source: string;
    readonly out: string;
}

/** Parse `--source <path>` / `--out <dir>`, resolving defaults against `repoRoot`. */
export function parseCliArgs(argv: readonly string[], repoRoot: string): CliArgs {
    let source = path.join(repoRoot, DEFAULT_SOURCE_REL);
    let out = path.join(repoRoot, DEFAULT_OUT_REL);
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === '--source' && next !== undefined) {
            source = path.resolve(next);
            i += 1;
        } else if (arg === '--out' && next !== undefined) {
            out = path.resolve(next);
            i += 1;
        }
    }
    return { source, out };
}

// CLI entry: `tsx tools/generate-icons.ts [--source <png>] [--out <dir>]`.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
    void (async (): Promise<void> => {
        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const { source, out } = parseCliArgs(process.argv.slice(2), repoRoot);
        const { written } = await generateIcons({ sourcePng: source, outDir: out });
        const rel = path.relative(repoRoot, out) || out;
        console.log(
            `[icons:generate] Wrote ${written.length} files to ${rel}/ from ${path.relative(repoRoot, source) || source}.`,
        );
    })();
}
