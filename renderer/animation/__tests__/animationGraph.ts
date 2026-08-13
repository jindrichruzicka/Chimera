/**
 * renderer/animation/__tests__/animationGraph.ts
 *
 * The esbuild analyzer both guards over `renderer/animation/` share: the
 * directory census (`animation-dir-census.test.ts`) and the pure-module graph
 * claim (`scheduler-purity.test.ts`). Not a test itself — one copy, so the two
 * guards cannot drift into measuring different graphs.
 *
 * **Two channels, because an import can reach a module without resolving into
 * it.** A binding the module USES pulls its target in as a resolved INPUT. A
 * binding it imports and never uses is elided by esbuild's TypeScript loader
 * before the target is ever resolved, so it reaches no input — but the import
 * record survives on the importer, marked external, carrying the specifier as
 * written. {@link analyze} therefore resolves every relative external against
 * its importer and reports both, unioned, as `reached`.
 *
 * Mechanism mirrors `renderer/input/__tests__/input-barrel-side-effects.test.ts`.
 */

import { build, type Plugin } from 'esbuild';
import { dirname, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The directory under analysis, as an absolute path. */
export const ANIMATION_DIR = resolve(__dirname, '..');

/** The workspace root, which every reported input path is relative to. */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** That same directory, spelled as the repo-relative prefix esbuild reports. */
export const ANIMATION_SUBTREE = 'renderer/animation/';

/** The paths that do NOT sit under `dirPrefix`. */
export function pathsOutside(paths: readonly string[], dirPrefix: string): readonly string[] {
    return paths.filter((path) => !path.startsWith(dirPrefix));
}

/**
 * `specifier`, as written on the module at `importerPath`, resolved to a
 * repo-relative path — or `null` when it is not relative and so names a package
 * rather than a file in this repo.
 */
export function resolveRelativeSpecifier(importerPath: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) {
        return null;
    }
    return posix.normalize(posix.join(posix.dirname(importerPath), specifier));
}

/** Marks every bare specifier external so the bundle holds only in-repo source. */
const externalizeBareImports: Plugin = {
    name: 'externalize-bare-imports',
    setup(b) {
        // esbuild filters are Go RE2 regexes — the JS `u` flag is rejected.
        b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
        b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, external: true }));
    },
};

export interface Analysis {
    /** Files that entered the bundle — every USED import resolves into one. */
    readonly inputs: readonly string[];
    /** Specifiers esbuild recorded without resolving them into the bundle. */
    readonly externals: readonly string[];
    /**
     * Every in-repo path the entry reaches on either channel: the inputs, plus
     * each relative external resolved against the module that wrote it. This is
     * what a boundary verdict is taken over.
     */
    readonly reached: readonly string[];
}

/** Bundle one entry point, or one synthetic source, and report what it reached. */
export async function analyze(
    entry: { readonly entryPoint: string } | { readonly source: string },
): Promise<Analysis> {
    const result = await build({
        ...('entryPoint' in entry
            ? { entryPoints: [entry.entryPoint] }
            : {
                  stdin: {
                      contents: entry.source,
                      resolveDir: ANIMATION_DIR,
                      sourcefile: 'census-control.ts',
                      loader: 'ts' as const,
                  },
              }),
        bundle: true,
        treeShaking: true,
        write: false,
        metafile: true,
        format: 'esm',
        platform: 'browser',
        jsx: 'automatic',
        logLevel: 'silent',
        // Pins what the metafile's input paths are relative TO. Without it they
        // follow the CWD vitest happened to run from — the repo root for a
        // single-file run, the renderer package dir under `pnpm -r test` — and
        // the `renderer/bridge/` prefix would silently stop matching in one of them.
        absWorkingDir: REPO_ROOT,
        plugins: [externalizeBareImports],
    });
    // esbuild reports POSIX-separated paths; normalize anyway so the prefixes
    // above are the only spelling the guards have to reason about.
    const normalize = (path: string): string => path.split(sep).join('/');

    const inputs = Object.keys(result.metafile.inputs).map(normalize);
    const externals = new Set<string>();
    const reached = new Set(inputs);
    for (const [importerPath, input] of Object.entries(result.metafile.inputs)) {
        for (const imported of input.imports) {
            if (!imported.external) {
                continue;
            }
            externals.add(imported.path);
            const resolved = resolveRelativeSpecifier(normalize(importerPath), imported.path);
            if (resolved !== null) {
                reached.add(resolved);
            }
        }
    }

    return { inputs, externals: [...externals], reached: [...reached] };
}
