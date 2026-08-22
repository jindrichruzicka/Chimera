/**
 * renderer/audio/__tests__/audioGraph.ts
 *
 * The esbuild analyzer the guards over `renderer/audio/` share: the barrel's
 * side-effect claim and the per-module purity claims. Not a test itself —
 * one copy, so the guards in this directory cannot drift into measuring different
 * graphs.
 *
 * **Two channels, because an import can reach a module without resolving into
 * it.** A binding the module USES pulls its target in as a resolved INPUT. A
 * binding it imports and never uses is elided by esbuild's TypeScript loader
 * before the target is ever resolved, so it reaches no input — but the import
 * record survives on the importer, marked external, carrying the specifier as
 * written. {@link analyze} therefore resolves every relative external against
 * its importer and reports both, unioned, as `reached` — carrying the
 * specifier's own extension, so that channel answers WHICH SUBTREE an edge
 * points into rather than which file, and a verdict over it is a prefix test.
 *
 * **What neither channel sees: an explicit `import type`.** That form is erased
 * outright, leaving no input and no import record, so a type-only edge is
 * invisible here whether it names a package or a sibling. Measured, not assumed
 * — and it is why a claim taken over this analyzer is a claim about what the
 * module pulls into a BUNDLE, which is what a purity or side-effect verdict is
 * about in the first place.
 *
 * Mechanism mirrors `renderer/animation/__tests__/animationGraph.ts`, and
 * `renderer/assets/__tests__/assetsGraph.ts` answers a narrower question the same way.
 * They are separate modules rather than one shared one: the single-sourcing above is a
 * claim about this directory's guards, not about the repo's.
 */

import { build, type Plugin } from 'esbuild';
import { dirname, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The directory under analysis, as an absolute path. */
export const AUDIO_DIR = resolve(__dirname, '..');

/** The workspace root, which every reported input path is relative to. */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** That same directory, spelled as the repo-relative prefix esbuild reports. */
export const AUDIO_SUBTREE = 'renderer/audio/';

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
                      resolveDir: AUDIO_DIR,
                      sourcefile: 'graph-control.ts',
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
        // the `renderer/audio/` prefix would silently stop matching in one of them.
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
