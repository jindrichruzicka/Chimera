/**
 * `create-chimera-game` CLI entry + scaffold core (F65, issue #799).
 *
 * Ties the pure substitution engine ({@link ./normalize}, {@link ./tokens}) to the filesystem:
 * resolve `templates/<id>/` (default `blank`), copy that tree into `apps/<game>` with every token
 * substituted in both file contents and file/directory names, then register the new app at the
 * repo root so its `workspace:*` deps resolve and it typechecks/boots.
 *
 * Template resolution is generic — there is no per-template branching, so a future template drops
 * in as a new `templates/<id>/` directory with zero changes here. This module imports no
 * `@chimera/*` package (boundary lint forbids it for `tools/`); it depends only on `node:*` and
 * the two sibling pure modules.
 *
 * The exported {@link scaffoldGame} performs the filesystem copy + root wiring and is what the
 * tests drive. The `pnpm install` side effect lives only in the CLI-entry guard at the bottom,
 * which is excluded under VITEST and wrapped in an async IIFE (tsx transforms `tools/*.ts` as
 * CommonJS — top-level `await` would crash it).
 *
 * The `--out <dir>` flag (see {@link ScaffoldGameOptions.outDir}) is the out-of-workspace mode the
 * `verify:scaffold` gate drives: it writes the app under `<dir>/apps/<kebab>`, skips the repo-root
 * wiring + `pnpm install`, and leaves the standalone root (manifest, tsconfig, install) to the gate.
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGameName, type GameNames } from './normalize';
import { findLeftoverTokens, renameTokensInPath, substituteTokens } from './tokens';

/** Top-level template subdirs never copied into the generated app (build output / deps). */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.next']);

/** The default template id when `--template` is omitted. */
const DEFAULT_TEMPLATE = 'blank';

export interface ScaffoldGameOptions {
    /** Absolute path to the monorepo root (holds `templates/`, `apps/`, `package.json`). */
    readonly repoRoot: string;
    /** Raw game name from the command line, in any casing. */
    readonly name: string;
    /** Template id to resolve under `templates/`; defaults to {@link DEFAULT_TEMPLATE}. */
    readonly template?: string;
    /**
     * Out-of-workspace destination root (the `--out` flag). When set, the app is written to
     * `<outDir>/apps/<kebab>` instead of `<repoRoot>/apps/<kebab>`, and the repo-root build
     * files are NOT wired — the gate (`verify:scaffold`) synthesizes a standalone root that
     * resolves `@chimera/*` from packed tarballs, so there is no monorepo root to register
     * into. Templates are always resolved from {@link repoRoot}, regardless of `outDir`.
     */
    readonly outDir?: string;
}

export interface ScaffoldGameResult {
    /** Absolute path to the newly created `apps/<kebab>` directory. */
    readonly appDir: string;
    /** The normalised name casings used for substitution. */
    readonly names: GameNames;
    /** The resolved template id. */
    readonly template: string;
    /** Paths of every written file, relative to {@link appDir}. */
    readonly filesWritten: readonly string[];
}

/** True when `target` exists (file or directory). */
async function pathExists(target: string): Promise<boolean> {
    try {
        await stat(target);
        return true;
    } catch {
        return false;
    }
}

/** The directory ids directly under `templates/`, sorted; empty when the dir is absent. */
async function listTemplateIds(templatesRoot: string): Promise<string[]> {
    try {
        const entries = await readdir(templatesRoot, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    } catch {
        return [];
    }
}

/**
 * Recursively collect every file under `dir` as an array of path segments (relative to `dir`),
 * skipping {@link SKIP_DIRS}. Returning segment arrays — rather than joined strings — keeps the
 * later rename/copy platform-independent (no POSIX `/` assumption).
 */
async function collectFiles(dir: string, segments: string[] = []): Promise<string[][]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[][] = [];
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            files.push(
                ...(await collectFiles(path.join(dir, entry.name), [...segments, entry.name])),
            );
        } else if (entry.isFile()) {
            files.push([...segments, entry.name]);
        }
    }
    return files;
}

/**
 * Add `@chimera/<kebab>` to the root `package.json` dependencies (kept alphabetically sorted)
 * and append the per-app `tsc --noEmit` line to the `typecheck` script — matching how
 * `apps/tactics` is wired. `package.json` is plain JSON, so it is parsed and reserialised.
 */
async function wireRootPackageJson(repoRoot: string, kebab: string): Promise<void> {
    const pkgPath = path.join(repoRoot, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        [key: string]: unknown;
    };

    const deps = { ...(pkg.dependencies ?? {}), [`@chimera/${kebab}`]: 'workspace:*' };
    pkg.dependencies = Object.fromEntries(
        Object.entries(deps).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );

    const typecheckLine = `tsc --noEmit -p apps/${kebab}/tsconfig.json`;
    if (
        typeof pkg.scripts?.['typecheck'] === 'string' &&
        !pkg.scripts['typecheck'].includes(typecheckLine)
    ) {
        pkg.scripts['typecheck'] = `${pkg.scripts['typecheck']} && ${typecheckLine}`;
    }

    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`, 'utf8');
}

/**
 * Append `{ "path": "./apps/<kebab>/tsconfig.build.json" }` to the root `tsconfig.build.json`
 * `references` array. That file is JSONC (carries an explanatory comment block), so the entry is
 * spliced textually rather than parsed + reserialised — which would strip the comments.
 */
async function wireRootTsconfigBuild(repoRoot: string, kebab: string): Promise<void> {
    const tsconfigPath = path.join(repoRoot, 'tsconfig.build.json');
    const raw = await readFile(tsconfigPath, 'utf8');
    const refPath = `./apps/${kebab}/tsconfig.build.json`;
    if (raw.includes(refPath)) return; // already registered

    const entry = `{ "path": "${refPath}" }`;
    // Capture the references array: open bracket ($1), existing items ($2), the newline ($3) and
    // indentation ($4) of the closing `]`. Re-emit them with the new entry appended as the last
    // item (one indent level deeper than the `]`).
    const updated = raw.replace(
        /("references"\s*:\s*\[)([\s\S]*?)(\r?\n)([ \t]*)\]/,
        `$1$2,$3$4    ${entry}$3$4]`,
    );
    if (updated === raw) {
        throw new Error(
            'Could not find a "references" array in tsconfig.build.json to register the new app.',
        );
    }
    await writeFile(tsconfigPath, updated, 'utf8');
}

/**
 * Scaffold a new game app from a template. Validates the name and resolves the template before
 * any filesystem write, refuses to clobber an existing `apps/<kebab>`, copies + substitutes the
 * tree, then wires the app into the repo-root build files. Does NOT run `pnpm install` — that is
 * the CLI entry's job, keeping this core fast and hermetic for tests.
 */
export async function scaffoldGame(options: ScaffoldGameOptions): Promise<ScaffoldGameResult> {
    const { repoRoot, name } = options;
    const template = options.template ?? DEFAULT_TEMPLATE;

    // 1. Validate the name (throws InvalidGameNameError) before touching the filesystem.
    const names = normalizeGameName(name);

    // 2. Resolve the template generically — no template id is hardcoded into this path.
    const templatesRoot = path.join(repoRoot, 'templates');
    const templateDir = path.join(templatesRoot, template);
    if (!(await pathExists(templateDir))) {
        const available = await listTemplateIds(templatesRoot);
        throw new Error(
            `Unknown template "${template}". Available templates: ${
                available.length > 0 ? available.join(', ') : '(none found)'
            }.`,
        );
    }

    // 3. Refuse to overwrite an existing app. In `--out` mode the app lands under the
    //    out-of-workspace destination root; otherwise under the monorepo root.
    const appsRoot = options.outDir ?? repoRoot;
    const appDir = path.join(appsRoot, 'apps', names.kebab);
    if (await pathExists(appDir)) {
        throw new Error(
            `apps/${names.kebab} already exists; refusing to overwrite. Remove it or pick another name.`,
        );
    }

    // 4. Plan the copy: substitute path segments + contents and assert no token survives, all
    //    before writing anything (so a substitution gap can never leave a partial app behind).
    //    Binary assets (images, fonts, …) are copied byte-for-byte: their bytes are read as a
    //    Buffer and written verbatim. Content substitution + the content leftover-check apply to
    //    text only — running them on binary would corrupt it — but the PATH is always tokenised
    //    and checked (a binary asset may still carry a token in its name).
    const planned: { relPath: string; destPath: string; content: string | Buffer }[] = [];
    for (const segments of await collectFiles(templateDir)) {
        const relPath = path.join(...segments.map((segment) => renameTokensInPath(segment, names)));
        const raw = await readFile(path.join(templateDir, ...segments));
        // A NUL byte never occurs in the UTF-8 source the templates ship, so it reliably
        // flags a binary file (the boundary between "substitute" and "copy verbatim").
        const content: string | Buffer = raw.includes(0)
            ? raw
            : substituteTokens(raw.toString('utf8'), names);
        const leftover = [
            ...findLeftoverTokens(relPath),
            ...(typeof content === 'string' ? findLeftoverTokens(content) : []),
        ];
        if (leftover.length > 0) {
            throw new Error(
                `Token substitution incomplete for ${relPath}: ${leftover.join(', ')}.`,
            );
        }
        planned.push({ relPath, destPath: path.join(appDir, relPath), content });
    }

    const filesWritten: string[] = [];
    for (const { relPath, destPath, content } of planned) {
        await mkdir(path.dirname(destPath), { recursive: true });
        // writeFile defaults a string to UTF-8 and writes a Buffer's bytes verbatim.
        await writeFile(destPath, content);
        filesWritten.push(relPath);
    }

    // 5. Register the new app at the repo root (full tactics parity) — but only for an
    //    in-workspace scaffold. In `--out` mode there is no monorepo root to wire; the
    //    standalone root the gate synthesizes owns its own manifest + tsconfig.
    if (options.outDir === undefined) {
        await wireRootPackageJson(repoRoot, names.kebab);
        await wireRootTsconfigBuild(repoRoot, names.kebab);
    }

    return { appDir, names, template, filesWritten };
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────
//
// Runs only when executed directly via `tsx tools/create-chimera-game/index.ts`. The VITEST
// guard keeps the real `pnpm install` / disk writes out of the unit-test surface. The body is an
// async IIFE rather than top-level `await`: tsx transforms `tools/*.ts` as CommonJS (the root
// package.json has no `"type": "module"`), and esbuild rejects top-level await in CJS output.

if (process.env['VITEST'] === undefined) {
    const invokedPath = process.argv[1];
    if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
        void (async (): Promise<void> => {
            const { parseArgs } = await import('node:util');
            const { spawnSync } = await import('node:child_process');
            try {
                const { values, positionals } = parseArgs({
                    args: process.argv.slice(2),
                    options: {
                        template: { type: 'string', default: DEFAULT_TEMPLATE },
                        out: { type: 'string' },
                    },
                    allowPositionals: true,
                });
                const name = positionals[0];
                if (name === undefined) {
                    throw new Error(
                        'Usage: create-chimera-game <name> [--template <id>] [--out <dir>]',
                    );
                }

                const repoRoot = path.resolve(
                    path.dirname(fileURLToPath(import.meta.url)),
                    '../..',
                );
                const outDir = values.out !== undefined ? path.resolve(values.out) : undefined;
                const result = await scaffoldGame({
                    repoRoot,
                    name,
                    template: values.template,
                    ...(outDir !== undefined ? { outDir } : {}),
                });
                console.log(
                    `[create-chimera-game] Scaffolded ${result.appDir} from template "${result.template}" (${result.filesWritten.length} files).`,
                );

                // `--out` mode is owned by verify:scaffold: it synthesizes a standalone root and
                // runs its OWN install (the app resolves @chimera/* from packed tarballs there),
                // so skip the in-workspace `pnpm install` + the workspace-flavoured next steps.
                if (outDir !== undefined) {
                    console.log(
                        '[create-chimera-game] Out-of-workspace scaffold — skipping pnpm install.',
                    );
                    return;
                }

                console.log('[create-chimera-game] Running pnpm install to link workspace:* deps…');
                const install = spawnSync('pnpm', ['install'], {
                    cwd: repoRoot,
                    stdio: 'inherit',
                    shell: false,
                });
                if (install.status !== 0) {
                    throw new Error(
                        `pnpm install exited with status ${install.status ?? 'unknown'}.`,
                    );
                }

                console.log('[create-chimera-game] Done. Next steps:');
                console.log('  pnpm typecheck');
                console.log(`  pnpm --filter @chimera/${result.names.kebab} build:app`);
            } catch (error) {
                console.error(
                    `[create-chimera-game] ${error instanceof Error ? error.message : String(error)}`,
                );
                process.exitCode = 1;
            }
        })();
    }
}
