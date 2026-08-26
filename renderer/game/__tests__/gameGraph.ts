/**
 * renderer/game/__tests__/gameGraph.ts
 *
 * The esbuild analyzer behind the game barrel's side-effect guard. Mechanism
 * mirrors `renderer/audio/__tests__/audioGraph.ts` — a separate copy for the
 * same reason that one is: the single-sourcing is a claim about a directory's
 * guards, not about the repo's.
 *
 * Two channels, because an import can reach a module without resolving into it.
 * A binding the module USES pulls its target in as a resolved INPUT. A binding
 * imported and never used is elided by esbuild's TypeScript loader before the
 * target is resolved, so it reaches no input — but the import record survives
 * on the importer, marked external, carrying the specifier as written. An
 * explicit `import type` is erased outright and is invisible on both channels,
 * which is why a verdict taken here is about what the barrel pulls into a
 * BUNDLE — exactly what a side-effect verdict is about.
 */

import { build, type Plugin } from 'esbuild';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The directory under analysis, as an absolute path. */
export const GAME_DIR = resolve(__dirname, '..');

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
    /** Files that entered the bundle — every USED import resolves into one. */
    readonly inputs: readonly string[];
    /** Specifiers esbuild recorded without resolving them into the bundle. */
    readonly externals: readonly string[];
}

/** Bundle one entry point and report what it reached. */
export async function analyze(entryPoint: string): Promise<Analysis> {
    const result = await build({
        entryPoints: [entryPoint],
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

    const normalize = (path: string): string => path.split(sep).join('/');
    const inputs = Object.keys(result.metafile.inputs).map(normalize);
    const externals = new Set<string>();
    for (const input of Object.values(result.metafile.inputs)) {
        for (const imported of input.imports) {
            if (imported.external) {
                externals.add(imported.path);
            }
        }
    }

    return { inputs, externals: [...externals] };
}
