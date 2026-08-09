/**
 * renderer/assets/__tests__/assetsGraph.ts
 *
 * The esbuild analyzer both guards over `renderer/assets/` share: the barrel's
 * side-effect census (`assets-barrel-side-effects.test.ts`) and the sheet
 * readers' purity claim (`sheet-reader-purity.test.ts`). Not a test itself — one
 * copy, so the two cannot drift into measuring different graphs.
 *
 * Mechanism mirrors `renderer/animation/__tests__/animationGraph.ts`, which
 * carries the long-form rationale for the two channels. The short version: a
 * binding a module USES resolves into an INPUT, while a binding it imports and
 * never uses is elided by esbuild's TypeScript loader before resolution and
 * survives only as an EXTERNAL specifier on the importer. A verdict that reads
 * one channel sees half the graph.
 */

import { build, type Plugin } from 'esbuild';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The directory under analysis, as an absolute path. */
export const ASSETS_DIR = resolve(__dirname, '..');

/** The workspace root, which every reported input path is relative to. */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

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
    /** Repo-relative files that entered the bundle — every USED import resolves into one. */
    readonly inputs: readonly string[];
    /** Specifiers esbuild recorded without resolving them into the bundle. */
    readonly externals: ReadonlySet<string>;
}

/** Bundle one module in `renderer/assets/` and report both channels. */
export async function analyzeModule(moduleFile: string): Promise<Analysis> {
    const result = await build({
        entryPoints: [resolve(ASSETS_DIR, moduleFile)],
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
        // single-file run, the renderer package dir under `pnpm -r test`.
        absWorkingDir: REPO_ROOT,
        plugins: [externalizeBareImports],
    });

    // esbuild reports POSIX-separated paths; normalize anyway so a prefix test
    // has only one spelling to reason about.
    const normalize = (path: string): string => path.split(sep).join('/');
    const externals = new Set<string>();
    for (const input of Object.values(result.metafile.inputs)) {
        for (const imported of input.imports) {
            if (imported.external) {
                externals.add(imported.path);
            }
        }
    }
    return { inputs: Object.keys(result.metafile.inputs).map(normalize), externals };
}

/** A forbidden external is the named runtime or any of its subpaths. */
export function importsRuntime(externals: ReadonlySet<string>, name: string): boolean {
    return [...externals].some((spec) => spec === name || spec.startsWith(`${name}/`));
}
