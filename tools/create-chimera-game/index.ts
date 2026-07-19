/**
 * `create-chimera-game` CLI entry + scaffold core.
 *
 * Ties the pure substitution engine ({@link ./normalize}, {@link ./tokens}) to the filesystem:
 * resolve `templates/<id>/` (default `blank`), copy that tree into `apps/<game>` with every token
 * substituted in both file contents and file/directory names, then register the new app at the
 * repo root so its `workspace:*` deps resolve and it typechecks/boots.
 *
 * Template resolution is generic — there is no per-template branching, so a future template drops
 * in as a new `templates/<id>/` directory with zero changes here. This module imports no
 * `@chimera-engine/*` package (boundary lint forbids it for `tools/`); it depends only on `node:*` and
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

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGameName, type GameNames } from './normalize';
import {
    buildStandaloneLauncherScript,
    buildStandaloneRootManifest,
    buildStandaloneRootTsconfig,
    buildStandaloneVitestConfig,
    buildStandaloneVscodeLaunchJson,
    buildStandaloneVscodeTasksJson,
    buildStandaloneVscodeExtensionsJson,
    buildStandaloneGitignore,
    buildStandaloneWorkspaceYaml,
    rewriteAppPackageForStandalone,
    rewriteAppTsconfigBuildForStandalone,
    rewriteE2eTsconfigForStandalone,
    rewriteE2ePlaywrightConfigForStandalone,
} from './standalone';
import {
    ENGINE_DEP_RANGES,
    ROOT_COMPILER_OPTIONS,
    ROOT_ENGINES,
    ROOT_PACKAGE_MANAGER,
    TOOLCHAIN_DEPS,
} from './toolchain.generated';
import { findLeftoverTokens, renameTokensInPath, substituteTokens } from './tokens';

/** Top-level template subdirs never copied into the generated app (build output / deps). */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.next']);

/** The default template id when `--template` is omitted. */
const DEFAULT_TEMPLATE = 'blank';

export interface ScaffoldGameOptions {
    /**
     * Absolute path to the monorepo root that owns the OUTPUT — it holds `apps/` (where the
     * generated app lands in the in-workspace path) and the root `package.json` / `tsconfig.build.json`
     * the in-workspace scaffold wires. It is NO LONGER where templates live: the template SOURCE is
     * resolved separately via {@link templatesRoot} (package-relative, so the published CLI bundles
     * its own templates rather than reading them from the consumer's repo).
     */
    readonly repoRoot: string;
    /** Raw game name from the command line, in any casing. */
    readonly name: string;
    /** Template id to resolve under {@link templatesRoot}; defaults to {@link DEFAULT_TEMPLATE}. */
    readonly template?: string;
    /**
     * Absolute path to the directory holding `templates/<id>/` skeletons. Decoupled from
     * {@link repoRoot} so the published initializer resolves its bundled templates relative to its
     * own code ({@link resolveTemplatesRoot}), not from the output repo. Defaults to
     * `<repoRoot>/templates` for backward compatibility with in-process callers (the tests).
     */
    readonly templatesRoot?: string;
    /**
     * Which kind of project to scaffold (default `'workspace'`):
     *   - `'workspace'`  — an in-monorepo app: written under `<outputRoot>/apps/<kebab>` and WIRED
     *     into the monorepo root (`package.json` deps + `tsconfig.build.json` references). Used by
     *     contributors via `pnpm create:game --workspace` and the existing in-process callers.
     *   - `'standalone'` — a SELF-CONTAINED project: the app under `<outputRoot>/apps/<kebab>` PLUS
     *     a synthesized project root (`package.json` toolchain manifest, `pnpm-workspace.yaml`,
     *     `vitest.config.mts`, `tsconfig.json`), and the app's `@chimera-engine/*` deps rewritten onto
     *     their published `^x.y.z` ranges. No monorepo is required to install + boot it.
     */
    readonly mode?: 'workspace' | 'standalone';
    /**
     * The project root the app + (standalone) root files are written under. Defaults to
     * {@link repoRoot}. For a standalone project this is the new project directory; the
     * `verify:scaffold` gate points it at a throwaway temp dir.
     */
    readonly outputRoot?: string;
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

/**
 * Resolve the bundled `templates/` directory relative to the CLI's own location, so the same
 * code works run-from-source (`tsx tools/create-chimera-game/index.ts` → `./templates`) and
 * run-from-built-package (`dist/index.js` → `../templates`, since `files:['dist','templates']`
 * ships `templates/` beside `dist/`). Probing both candidates — rather than branching on a build
 * flag — keeps the resolution declarative and testable via the injected `exists` predicate.
 *
 * @param entryDir absolute directory of the running entry module (`dirname(import.meta.url)`).
 */
export function resolveTemplatesRoot(
    entryDir: string,
    exists: (candidate: string) => boolean = existsSync,
): string {
    const sourceLayout = path.join(entryDir, 'templates');
    if (exists(sourceLayout)) return sourceLayout;
    // Built layout: the entry is `<pkg>/dist/index.js`, templates ship at `<pkg>/templates`.
    return path.join(entryDir, '..', 'templates');
}

/** The directory ids directly under `templatesRoot`, sorted; empty when the dir is absent. */
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
 * Add `@chimera-engine/<kebab>` to the root `package.json` dependencies (kept alphabetically sorted),
 * append the per-app `tsc --noEmit` line to the `typecheck` script, and register a per-game
 * `package:<kebab>` script — matching how `apps/tactics` is wired (deps + typecheck + the
 * `package:tactics` build-and-package flow). `package.json` is plain JSON, so it is parsed and
 * reserialised.
 */
async function wireRootPackageJson(repoRoot: string, kebab: string): Promise<void> {
    const pkgPath = path.join(repoRoot, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        [key: string]: unknown;
    };

    const deps = { ...(pkg.dependencies ?? {}), [`@chimera-engine/${kebab}`]: 'workspace:*' };
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

    // The per-game distributable flow, mirroring the root `package:tactics`: rebuild the engine
    // packages, build the app's Next renderer, bundle main/preload, then run electron-builder.
    // `??=` keeps it idempotent — a re-scaffold never clobbers a hand-edited script.
    pkg.scripts ??= {};
    pkg.scripts[`package:${kebab}`] ??=
        `pnpm build:packages && next build apps/${kebab}/renderer && ` +
        `pnpm --filter @chimera-engine/${kebab} build:app && ` +
        `pnpm --filter @chimera-engine/${kebab} run package`;

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
 * Emit the SELF-CONTAINED project root around a freshly-scaffolded `apps/<kebab>` so the project
 * installs + boots with no monorepo: the toolchain manifest (`package.json`), the lone-member
 * `pnpm-workspace.yaml`, the unit-arm `vitest.config.mts`, and a `tsconfig.json` carrying the
 * frozen root `compilerOptions` the app's tsconfigs `extends`. Finally rewrites the app's
 * `@chimera-engine/*` deps onto their published ranges and wires the Electron-host node_modules env into
 * its build/e2e scripts. The toolchain + engine versions come from the committed snapshot
 * ({@link TOOLCHAIN_DEPS} / {@link ENGINE_DEP_RANGES} / {@link ROOT_COMPILER_OPTIONS}), so no
 * monorepo read is needed at `npm create` time. Shared by the published CLI and the
 * `verify:scaffold` gate (which then layers tarball overrides on top) — one emission path.
 */
async function emitStandaloneProject(
    outputRoot: string,
    appDir: string,
    kebab: string,
    title: string,
): Promise<void> {
    const manifest = buildStandaloneRootManifest({
        name: kebab,
        toolchainDeps: TOOLCHAIN_DEPS,
        packageManager: ROOT_PACKAGE_MANAGER,
        engines: ROOT_ENGINES,
    });
    await writeFile(
        path.join(outputRoot, 'package.json'),
        `${JSON.stringify(manifest, null, 4)}\n`,
        'utf8',
    );
    await writeFile(
        path.join(outputRoot, 'pnpm-workspace.yaml'),
        buildStandaloneWorkspaceYaml(),
        'utf8',
    );
    // Synthesized (npm strips template .gitignore files from tarballs); covers the
    // dev-harness `.dev-userdata/` dirs alongside install/build output.
    await writeFile(path.join(outputRoot, '.gitignore'), buildStandaloneGitignore(), 'utf8');
    await writeFile(
        path.join(outputRoot, 'vitest.config.mts'),
        buildStandaloneVitestConfig(kebab),
        'utf8',
    );
    await writeFile(
        path.join(outputRoot, 'tsconfig.json'),
        buildStandaloneRootTsconfig(ROOT_COMPILER_OPTIONS),
        'utf8',
    );

    // The `pnpm start` launcher. It strips ELECTRON_RUN_AS_NODE before spawning Electron so a
    // launch from a leaked env (some IDE/agent terminals, CI) runs Electron rather than plain
    // Node — the latter crashes at startup with a cryptic undefined-deref.
    const scriptsDir = path.join(outputRoot, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(
        path.join(scriptsDir, 'launch.mjs'),
        buildStandaloneLauncherScript(kebab),
        'utf8',
    );

    // The IDE debug layer: a project-root `.vscode/` with "Run <Game>" + "Debug <Game>" launch
    // configs and their build task. Standalone-only — a `--workspace` scaffold inherits the
    // monorepo's own root `.vscode/`. Root-placed so it targets the workspace VS Code opens; the
    // Debug config binds main-process breakpoints against the source-mapped `dist/electron/main.js`.
    const vscodeDir = path.join(outputRoot, '.vscode');
    await mkdir(vscodeDir, { recursive: true });
    await writeFile(
        path.join(vscodeDir, 'launch.json'),
        buildStandaloneVscodeLaunchJson(kebab, title),
        'utf8',
    );
    await writeFile(
        path.join(vscodeDir, 'tasks.json'),
        buildStandaloneVscodeTasksJson(kebab, title),
        'utf8',
    );
    // Workspace-recommended extensions so VS Code prompts to install the Vitest + Playwright Test
    // Explorer providers on first open — the Test Explorer only shows a framework's tests when its
    // extension is present.
    await writeFile(
        path.join(vscodeDir, 'extensions.json'),
        buildStandaloneVscodeExtensionsJson(),
        'utf8',
    );

    const appPkgPath = path.join(appDir, 'package.json');
    const rawAppPkg = await readFile(appPkgPath, 'utf8');
    await writeFile(
        appPkgPath,
        rewriteAppPackageForStandalone(rawAppPkg, {
            engineRanges: ENGINE_DEP_RANGES,
            toolchainDeps: TOOLCHAIN_DEPS,
            // pnpm runs the app's scripts with cwd = the app dir, so a relative `node_modules`
            // resolves to the installed `<app>/node_modules`.
            nodeModulesEnv: 'node_modules',
        }),
        'utf8',
    );

    // The template's `tsconfig.build.json` references + `e2e/tsconfig.json` paths point at sibling
    // monorepo packages (`../../simulation/...`, `simulation/dist/*`, …) — correct in `--workspace`
    // mode, broken out-of-repo. Neutralise them so `tsc` / Playwright resolve the npm-installed
    // `@chimera-engine/*` from `node_modules` instead. The template stays workspace-valid; only the
    // emitted copies are rewritten. Tolerant of a template that omits either file (a no-op then).
    await rewriteFileIfPresent(
        path.join(appDir, 'tsconfig.build.json'),
        rewriteAppTsconfigBuildForStandalone,
    );
    await rewriteFileIfPresent(
        path.join(appDir, 'e2e', 'tsconfig.json'),
        rewriteE2eTsconfigForStandalone,
    );
    // Make the e2e Playwright config self-set CHIMERA_VERIFY_PACK_NODE_MODULES so runners that bypass
    // the `test:e2e` script (the VS Code Playwright Test Explorer, `npx playwright test`, the launch
    // config) still resolve `@chimera-engine/electron` from node_modules — otherwise the global-setup
    // bundler fails with "Could not resolve @chimera-engine/electron/main".
    await rewriteFileIfPresent(
        path.join(appDir, 'e2e', 'playwright.config.ts'),
        rewriteE2ePlaywrightConfigForStandalone,
    );
}

/** Read a file, apply `transform`, write it back — skipping silently if the file does not exist. */
async function rewriteFileIfPresent(
    filePath: string,
    transform: (raw: string) => string,
): Promise<void> {
    if (!(await pathExists(filePath))) return;
    await writeFile(filePath, transform(await readFile(filePath, 'utf8')), 'utf8');
}

/**
 * Scaffold a new game app from a template. Validates the name and resolves the template before
 * any filesystem write, refuses to clobber an existing `apps/<kebab>`, copies + substitutes the
 * tree, then either WIRES the app into the monorepo root (`'workspace'` mode) or emits a
 * self-contained project root around it ({@link emitStandaloneProject}, `'standalone'` mode). Does
 * NOT run `pnpm install` — that is the CLI entry's job, keeping this core fast + hermetic for tests.
 */
export async function scaffoldGame(options: ScaffoldGameOptions): Promise<ScaffoldGameResult> {
    const { repoRoot, name } = options;
    const template = options.template ?? DEFAULT_TEMPLATE;

    // 1. Validate the name (throws InvalidGameNameError) before touching the filesystem.
    const names = normalizeGameName(name);

    // 2. Resolve the template generically — no template id is hardcoded into this path. The
    //    template SOURCE root is decoupled from repoRoot (the published CLI bundles its own
    //    templates); it defaults to `<repoRoot>/templates` for in-process callers.
    const templatesRoot = options.templatesRoot ?? path.join(repoRoot, 'templates');
    const templateDir = path.join(templatesRoot, template);
    if (!(await pathExists(templateDir))) {
        const available = await listTemplateIds(templatesRoot);
        throw new Error(
            `Unknown template "${template}". Available templates: ${
                available.length > 0 ? available.join(', ') : '(none found)'
            }.`,
        );
    }

    // 3. Refuse to overwrite an existing app. The app lands under `<outputRoot>/apps/<kebab>`
    //    (outputRoot defaults to the monorepo root for the in-workspace path).
    const mode = options.mode ?? 'workspace';
    const outputRoot = options.outputRoot ?? repoRoot;
    const appDir = path.join(outputRoot, 'apps', names.kebab);
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

    // 5. Finish per mode: WIRE the app into the monorepo root (full tactics parity), or EMIT a
    //    self-contained project root around it.
    if (mode === 'workspace') {
        await wireRootPackageJson(repoRoot, names.kebab);
        await wireRootTsconfigBuild(repoRoot, names.kebab);
    } else {
        await emitStandaloneProject(outputRoot, appDir, names.kebab, names.title);
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
                        workspace: { type: 'boolean', default: false },
                    },
                    allowPositionals: true,
                });
                const name = positionals[0];
                if (name === undefined) {
                    throw new Error(
                        'Usage: create-chimera-game <name> [--template <id>] [--out <dir>] [--workspace]',
                    );
                }

                const entryDir = path.dirname(fileURLToPath(import.meta.url));
                // repoRoot is the monorepo root (two up from tools/create-chimera-game) used for
                // the in-workspace output + root wiring; templatesRoot is resolved relative to the
                // CLI's own code so a published, out-of-tree install finds its bundled templates.
                const repoRoot = path.resolve(entryDir, '../..');
                const templatesRoot = resolveTemplatesRoot(entryDir);

                // Resolve the mode, where the project is written, and where (if anywhere) to install:
                //   --workspace  → in-monorepo app, wired into repoRoot, install at repoRoot.
                //   --out <dir>  → standalone project AT <dir>; the verify:scaffold gate owns install.
                //   (default)    → standalone project IN <cwd> (the current directory), install there.
                let scaffoldOptions: ScaffoldGameOptions;
                let installCwd: string | undefined;
                if (values.workspace) {
                    scaffoldOptions = {
                        repoRoot,
                        name,
                        template: values.template,
                        templatesRoot,
                        mode: 'workspace',
                    };
                    installCwd = repoRoot;
                } else if (values.out !== undefined) {
                    scaffoldOptions = {
                        repoRoot,
                        name,
                        template: values.template,
                        templatesRoot,
                        mode: 'standalone',
                        outputRoot: path.resolve(values.out),
                    };
                    installCwd = undefined;
                } else {
                    // Default: scaffold the self-contained project straight INTO the current
                    // directory — the intended flow is "make a folder, open it, run this here", so
                    // the app + project root land in <cwd> with no redundant <kebab>/ wrapper. Guard
                    // against clobbering: a package.json in <cwd> means a project already lives here,
                    // and we would overwrite its root (package.json / tsconfig.json / …), so refuse.
                    const projectRoot = process.cwd();
                    if (existsSync(path.join(projectRoot, 'package.json'))) {
                        throw new Error(
                            'The current directory already contains a package.json — refusing to ' +
                                'scaffold over an existing project. Run this in an empty directory, ' +
                                'or pass --out <dir> to target a different one.',
                        );
                    }
                    scaffoldOptions = {
                        repoRoot,
                        name,
                        template: values.template,
                        templatesRoot,
                        mode: 'standalone',
                        outputRoot: projectRoot,
                    };
                    installCwd = projectRoot;
                }

                const result = await scaffoldGame(scaffoldOptions);
                console.log(
                    `[create-chimera-game] Scaffolded ${result.appDir} from template "${result.template}" (${result.filesWritten.length} files).`,
                );

                // `--out` mode is owned by verify:scaffold: it layers tarball overrides on the
                // emitted root and runs its OWN install, so skip install + the next-steps here.
                if (installCwd === undefined) {
                    console.log(
                        '[create-chimera-game] Out-of-workspace scaffold — skipping pnpm install (the gate installs).',
                    );
                    return;
                }

                console.log(`[create-chimera-game] Running pnpm install in ${installCwd}…`);
                const install = spawnSync('pnpm', ['install'], {
                    cwd: installCwd,
                    stdio: 'inherit',
                    shell: false,
                });
                if (install.status !== 0) {
                    throw new Error(
                        `pnpm install exited with status ${install.status ?? 'unknown'}.`,
                    );
                }

                console.log('[create-chimera-game] Done. Next steps:');
                if (values.workspace) {
                    console.log('  pnpm typecheck');
                    console.log(`  pnpm --filter @chimera-engine/${result.names.kebab} build:app`);
                } else {
                    // Standalone default scaffolds into <cwd>, so the project is already the cwd —
                    // no `cd` step to print. `pnpm start` (the launcher) is the run step; it strips
                    // ELECTRON_RUN_AS_NODE so a launch from a leaked env does not crash.
                    console.log(`  pnpm --filter @chimera-engine/${result.names.kebab} test`);
                    console.log(`  pnpm exec next build apps/${result.names.kebab}/renderer`);
                    console.log(`  pnpm --filter @chimera-engine/${result.names.kebab} build:app`);
                    console.log('  pnpm start');
                    console.log('  pnpm start:debug   # windowed + DevTools + F9 Debug Inspector');
                    console.log(
                        '  pnpm dev:mp 2      # instant 2-player multiplayer session (dev/scenarios/default.json: pnpm dev:mp --scenario default)',
                    );
                    console.log(
                        `  # or open this folder in VS Code and run the "Debug ${result.names.title}" launch config for breakpoints`,
                    );
                }
            } catch (error) {
                console.error(
                    `[create-chimera-game] ${error instanceof Error ? error.message : String(error)}`,
                );
                process.exitCode = 1;
            }
        })();
    }
}
