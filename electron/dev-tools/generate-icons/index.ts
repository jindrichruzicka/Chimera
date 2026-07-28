import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// TYPE-only, and load-bearing that they stay that way: type imports are erased, so
// these describe the codecs without putting either in this module's runtime graph.
import type SharpFactory from 'sharp';
import type * as Png2Icons from 'png2icons';

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
 * Loose PNGs are downscaled with `sharp` (libvips) for crisp small sizes; the
 * `.icns`/`.ico` containers are assembled with the pure-JS `png2icons`. Both are
 * optional peer dependencies loaded on demand — see `loadIconCodecs`.
 *
 * This module is emitted into the package's `dist/` and therefore travels inside the
 * published tarball, but nothing in a game's runtime graph reaches it.
 *
 * Regenerate (one-liner): `pnpm icons:generate`
 *
 * CLI:
 *   tsx electron/dev-tools/generate-icons/index.ts [--source <master.png>] [--out <dir>]
 *
 * Defaults: source `docs/assets/chimera-logo-compact.png`, out `electron/assets/icons`,
 * both resolved against the repo root (see `resolveRepoRoot`).
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

/** Resolves a bare module specifier — the seam the codec load is driven through. */
export type ModuleImporter = (specifier: string) => Promise<unknown>;

/** The two image codecs, unwrapped from the interop shape they arrived in. */
export interface IconCodecs {
    readonly sharp: typeof SharpFactory;
    readonly png2icons: typeof Png2Icons;
}

/**
 * What a run says when a codec is not installed — the deliverable of the optional-peer
 * contract. Absent it, a game author regenerating icons for the first time gets a bare
 * `ERR_MODULE_NOT_FOUND` naming a package they never asked for.
 *
 * Reserved for genuinely-absent codecs. An installed-but-broken one gets a different
 * message: telling someone to install what they already have is worse than useless.
 */
export const MISSING_CODECS_MESSAGE =
    'generate-icons: sharp + png2icons are required to generate icons and are optional peer ' +
    'dependencies. Install them as devDependencies: pnpm add -D sharp png2icons';

/** Node's two codes for "no such module", across the ESM and CJS resolvers. */
const MODULE_NOT_FOUND_CODES: ReadonlySet<string> = new Set([
    'ERR_MODULE_NOT_FOUND',
    'MODULE_NOT_FOUND',
]);

/** Every png2icons builder `generateIcons` calls — not a representative one. */
const PNG2ICONS_BUILDERS = ['createICNS', 'createICO'] as const;

/** The resampling constant `generateIcons` passes to both builders. */
const PNG2ICONS_CONSTANT = 'BICUBIC2';

/**
 * Load the codecs on demand.
 *
 * They are deliberately NOT module-top imports. `sharp` is a multi-megabyte
 * platform-specific native binary, and both are optional peers precisely so a game
 * that never regenerates its icons installs neither — but a static import would throw
 * at MODULE LOAD in exactly that install, before any message could be printed. Loading
 * here, inside the one path that needs them, is what makes the failure explainable.
 *
 * The two packages arrive in different interop shapes, and each has a form that
 * silently yields `undefined` rather than failing:
 *   - `sharp` is CJS `module.exports = fn`, so ESM presents the function as `default`
 *     while a CJS transform hands back the function itself;
 *   - `png2icons` marks itself `__esModule` and publishes named exports, so its
 *     namespace carries the API directly while a default import can resolve to
 *     nothing. It is accepted under a `default` slot too, since which one a loader
 *     produces is a property of the loader, not of this tool.
 */
export async function loadIconCodecs(
    importer: ModuleImporter = (specifier) => import(specifier),
): Promise<IconCodecs> {
    // Sequential, and sharp fully resolved first: when BOTH codecs are unusable the
    // report names sharp, rather than whichever promise happened to settle first.
    const sharp = unwrapSharp(await importCodec(importer, 'sharp'));
    const png2icons = unwrapPng2Icons(await importCodec(importer, 'png2icons'));
    return { sharp, png2icons };
}

/**
 * Import one codec, separating "not installed" from "installed but will not load".
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
            throw new Error(MISSING_CODECS_MESSAGE, { cause: error });
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

/**
 * A codec resolved, but not to something this tool can drive. Names which codec and
 * what it lacked, because the alternative is a `TypeError` thrown from inside the
 * generate loop with a half-written icon set already on disk.
 */
function unusableCodec(specifier: string, lacking: string): Error {
    return new Error(
        `generate-icons: '${specifier}' resolved but ${lacking}. An incompatible version is ` +
            `the likely cause.`,
    );
}

function unwrapSharp(module: unknown): IconCodecs['sharp'] {
    // Optional chaining, not a plain property read: `importer` is part of the public
    // options, so a loader handing back `null` reaches here, and a raw
    // "cannot read properties of null" is the opaque failure this path exists to
    // prevent.
    const candidate = (module as { default?: unknown } | null | undefined)?.default ?? module;
    if (typeof candidate !== 'function') {
        throw unusableCodec('sharp', 'is not callable');
    }
    return candidate as IconCodecs['sharp'];
}

function unwrapPng2Icons(module: unknown): IconCodecs['png2icons'] {
    const candidate = providesIconBuilders(module)
        ? module
        : (module as { default?: unknown } | null | undefined)?.default;
    if (!providesIconBuilders(candidate)) {
        throw unusableCodec(
            'png2icons',
            `does not provide ${PNG2ICONS_BUILDERS.join('/')} and the ${PNG2ICONS_CONSTANT} constant`,
        );
    }
    return candidate as IconCodecs['png2icons'];
}

/**
 * Whether `value` carries every png2icons member the generate path uses. Checking all
 * of them rather than the first is what makes the guard's promise true: a codec with
 * `createICNS` but no `createICO` passes a one-member check and then throws mid-run,
 * after the loose PNGs and the `.icns` have already been written.
 *
 * This is also how namespace-vs-default is decided — on the API, not on `__esModule`.
 */
function providesIconBuilders(value: unknown): boolean {
    const codec = value as Record<string, unknown> | null | undefined;
    return (
        PNG2ICONS_BUILDERS.every((name) => typeof codec?.[name] === 'function') &&
        // The TYPE, not mere presence: the constant is declared a number, and a
        // namespace whose `BICUBIC2` is something else is not the namespace this
        // module was written against.
        typeof codec?.[PNG2ICONS_CONSTANT] === 'number'
    );
}

export interface GenerateIconsOptions {
    /** Absolute path to the square master logo PNG. */
    readonly sourcePng: string;
    /** Absolute output directory; created if missing. */
    readonly outDir: string;
    /**
     * Overrides how the image codecs are resolved. Defaults to a real dynamic import;
     * supplying one substitutes the module resolution itself, which is the only way to
     * reach the codec-absent path from an environment that has both installed.
     */
    readonly importer?: ModuleImporter;
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
    const { sourcePng, outDir, importer } = options;

    // An absent codec and an unreadable master both resolve before the mkdir, so
    // neither leaves an empty directory behind as evidence that it tried. A master
    // that reads but does not DECODE still does — the decode lives inside the write
    // loop, which is past the point of no output.
    const { sharp, png2icons } = await loadIconCodecs(importer);
    const master = await readFile(sourcePng);

    await mkdir(outDir, { recursive: true });
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

/**
 * The root `DEFAULT_SOURCE_REL` and `DEFAULT_OUT_REL` are relative to, derived from the
 * calling module's own URL: generate-icons → dev-tools → electron → repo root.
 *
 * Valid ONLY for this module's SOURCE location. The tsc-emitted copy sits one level
 * deeper, under `electron/dist/`, so the same three-level walk from there lands on the
 * package root and both defaults resolve to paths that do not exist. Callers outside the
 * repo have no repo root at all and must pass `--source`/`--out` explicitly.
 */
export function resolveRepoRoot(moduleUrl: string): string {
    return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..', '..', '..');
}

// CLI entry: `tsx electron/dev-tools/generate-icons/index.ts [--source <png>] [--out <dir>]`.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
    void (async (): Promise<void> => {
        const repoRoot = resolveRepoRoot(import.meta.url);
        const { source, out } = parseCliArgs(process.argv.slice(2), repoRoot);
        const { written } = await generateIcons({ sourcePng: source, outDir: out });
        const rel = path.relative(repoRoot, out) || out;
        console.log(
            `[icons:generate] Wrote ${written.length} files to ${rel}/ from ${path.relative(repoRoot, source) || source}.`,
        );
    })();
}
