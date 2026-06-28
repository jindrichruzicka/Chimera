/**
 * tools/verify-publish.ts
 *
 * `verify:publish` — the publish-readiness gate (issue #804, F66).
 *
 * `verify:pack` already proves the packed `exports`/`files` surface resolves end to
 * end. This sibling gate proves the orthogonal property: every `@chimera-engine/*` package
 * is publish-ready — its declared `dependencies` actually cover every external module
 * its built `dist/` imports, its manifest is publint-clean, and it dry-run-publishes.
 *
 * Day-to-day the workspace hoists shared deps (zod, pino, …) to the repo root, so a
 * package can `import` a module it never declares and still resolve locally — then
 * break on an isolated registry install. The centerpiece `depcheck` step catches that
 * class statically, without running anything:
 *
 *   1. `pnpm build:packages`   — emit every `@chimera-engine/*` `dist/`
 *   2. depcheck                — for each package, scan its published `.js` files for
 *                                external specifiers (TS pre-processor: import/export-from,
 *                                dynamic import, require — comments/strings ignored),
 *                                normalize each to a package name, and assert it is
 *                                declared in deps/peer/optional (or is a node builtin
 *                                or the package itself)
 *   3. `publint run <dir> --strict` per package — exports/files/types correctness
 *   4. `pnpm publish --dry-run --no-git-checks` per package — manifest + workspace:*
 *                                rewrite validation against the real publish path
 *
 * `depcheck` scans the runtime `.js` only, never `.d.ts`: a TYPE-ONLY import (e.g.
 * simulation's `import type * as React from 'react'`) erases from `.js`, so it is
 * correctly never flagged as a missing runtime dependency.
 *
 * `--self-test` proves the gate bites: it feeds the depcheck a synthetic dist file
 * that imports an undeclared module and asserts the scan FAILS. If that slips through,
 * the self-test exits non-zero — the gate is not trustworthy.
 *
 * Invariants upheld:
 *   #1  — depcheck asserts each package's declared deps cover its real runtime imports,
 *         keeping the inward `@chimera-engine/*` DAG honest (no undeclared cross-edge masked
 *         by root hoisting).
 *   #2  — lives in `tools/`; imports only node builtins + the side-effect-free
 *         `verify-shared` + the `typescript` pre-processor — never a package or app.
 *   #47 — publint guards that each package publishes exactly its public `exports`/`files`.
 *
 * Usage (run via `pnpm verify:publish` / `pnpm verify:publish:selftest`):
 *   tsx tools/verify-publish.ts            # positive gate
 *   tsx tools/verify-publish.ts --self-test  # negative gate (must detect an undeclared import)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
    CHIMERA_PACKAGES,
    isNodeBuiltin,
    specifierToPackageName,
    type FsLike,
    type RunFn,
    type RunResult,
} from './verify-shared';

// The injected I/O surfaces, engine-package list, and the two pure specifier helpers
// live in `verify-shared.ts` (shared with verify-pack / verify-scaffold). Re-exported
// here so this module's public surface — and its test — is self-contained.
export {
    CHIMERA_PACKAGES,
    specifierToPackageName,
    isNodeBuiltin,
    type FsLike,
    type RunFn,
    type RunOptions,
    type RunResult,
} from './verify-shared';

/**
 * The published `.js` files of the package rooted at `pkgDir` (absolute), as the
 * registry would receive them — i.e. exactly what `npm pack` ships, honoring each
 * package's `files`/negation. Injected so tests enumerate an in-memory map. Scanning
 * the published set (not raw `dist/`) is deliberate: simulation excludes its
 * `__test-support__/*.js` from publish, so those (and their dev-only `vitest` import)
 * must never reach the depcheck.
 */
export type ListPublishedJsFiles = (pkgDir: string) => Promise<readonly string[]>;

export interface VerifyPublishDeps {
    readonly run: RunFn;
    /** Only `readFile` is needed (package.json + each published `.js`). */
    readonly fs: Pick<FsLike, 'readFile'>;
    readonly listPublishedJsFiles: ListPublishedJsFiles;
    readonly log: (message: string) => void;
    /** Absolute repo root — package dirs resolve under it. */
    readonly repoRoot: string;
}

/**
 * Specifiers a package's published dist may import that are NOT npm packages and so
 * are intentionally undeclared: virtual build-time seams the CONSUMER resolves via a
 * bundler alias. `chimera-game-registration` is the renderer's game-agnostic
 * registration seam (F63) — `renderer/dist/app/GameRegistrationBootstrap.js` imports
 * it, and each consumer app aliases it to its own game module at build time.
 */
export const CONSUMER_PROVIDED_SPECIFIERS: readonly string[] = ['chimera-game-registration'];

/** The dependency-bearing slice of a package.json the depcheck needs. */
export interface PackageManifest {
    readonly name: string;
    readonly dependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
    readonly optionalDependencies?: Record<string, string>;
}

export interface UndeclaredFinding {
    /** The package whose dist imports an undeclared module. */
    readonly pkg: string;
    /** The normalized package name that is missing from the manifest. */
    readonly specifier: string;
    /** The raw specifier as written in the dist `.js`. */
    readonly raw: string;
    /** Absolute path of the dist `.js` the import came from. */
    readonly file: string;
}

export type VerifyPublishStep = 'build' | 'depcheck' | 'publint' | 'dry-run';

export interface VerifyPublishResult {
    readonly ok: boolean;
    readonly failedStep?: VerifyPublishStep;
    readonly undeclared?: readonly UndeclaredFinding[];
}

export interface VerifyPublishOptions {
    /** Skip `pnpm build:packages` (dist already fresh) — used to exercise the gate cheaply. */
    readonly skipBuild?: boolean;
    /** Skip the per-package publint pass. */
    readonly skipPublint?: boolean;
    /** Run `pnpm publish --dry-run` per package (default true; requires `private:false`). */
    readonly dryRun?: boolean;
}

/** Thrown by a step runner on a non-zero exit so `verifyPublish` can report the step. */
class VerifyPublishStepError extends Error {
    constructor(
        readonly step: VerifyPublishStep,
        message: string,
    ) {
        super(message);
        this.name = 'VerifyPublishStepError';
    }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Every module specifier a built `.js` references — import/export-from, side-effect
 * `import 'x'`, dynamic `import('x')`, and `require('x')` — via the TypeScript
 * pre-processor, which natively ignores comments and string literals (so a
 * commented-out `@chimera-engine/core` import is never extracted). Returns raw specifiers
 * (relative ones included; the caller drops them).
 */
export function extractImportSpecifiers(jsSource: string): string[] {
    const info = ts.preProcessFile(
        jsSource,
        /* readImportFiles */ true,
        /* detectJavaScriptImports */ true,
    );
    return info.importedFiles.map((ref) => ref.fileName);
}

/** Package names a package's dist may import without flagging: declared deps + own name. */
export function buildAllowlist(manifest: PackageManifest): ReadonlySet<string> {
    return new Set<string>([
        manifest.name,
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
}

/**
 * The centerpiece, PURE: given a package's manifest + a `{ distJsPath -> source }`
 * map, return every external specifier whose package name is NOT declared. Relative
 * imports, node builtins, and `extraAllowed` (consumer-provided virtual seams) are
 * skipped; findings are de-duplicated per (package, file).
 */
export function findUndeclaredDeps(
    manifest: PackageManifest,
    files: ReadonlyMap<string, string>,
    extraAllowed: Iterable<string> = [],
): UndeclaredFinding[] {
    const allow = buildAllowlist(manifest);
    const extra = new Set(extraAllowed);
    const findings: UndeclaredFinding[] = [];
    const seen = new Set<string>();
    for (const [file, source] of files) {
        for (const raw of extractImportSpecifiers(source)) {
            if (raw.startsWith('.') || raw.startsWith('/')) continue;
            if (isNodeBuiltin(raw)) continue;
            const pkgName = specifierToPackageName(raw);
            if (allow.has(pkgName) || extra.has(pkgName)) continue;
            const key = `${pkgName}::${file}`;
            if (seen.has(key)) continue;
            seen.add(key);
            findings.push({ pkg: manifest.name, specifier: pkgName, raw, file });
        }
    }
    return findings;
}

/** `pnpm exec publint run <dir> --strict` argv (warnings fail the gate). */
export function publintArgs(pkgDir: string): string[] {
    return ['exec', 'publint', 'run', pkgDir, '--strict'];
}

/** `pnpm publish --dry-run --no-git-checks` argv (run with cwd = the package dir). */
export function publishDryRunArgs(): string[] {
    return ['publish', '--dry-run', '--no-git-checks'];
}

// ── Step runners ───────────────────────────────────────────────────────────────

function assertStepOk(step: VerifyPublishStep, result: RunResult): void {
    if (result.status !== 0) {
        throw new VerifyPublishStepError(
            step,
            `verify:publish: step "${step}" failed (exit ${result.status})`,
        );
    }
}

async function readManifest(deps: VerifyPublishDeps, pkgDir: string): Promise<PackageManifest> {
    const raw = await deps.fs.readFile(path.join(deps.repoRoot, pkgDir, 'package.json'));
    return JSON.parse(raw) as PackageManifest;
}

/** Scan one package's PUBLISHED `.js` files for external imports it does not declare. */
export async function checkPackageDeps(
    deps: VerifyPublishDeps,
    pkg: { readonly name: string; readonly dir: string },
): Promise<UndeclaredFinding[]> {
    const manifest = await readManifest(deps, pkg.dir);
    const pkgDir = path.join(deps.repoRoot, pkg.dir);
    const jsFiles = await deps.listPublishedJsFiles(pkgDir);
    const sources = new Map<string, string>();
    for (const file of jsFiles) {
        sources.set(file, await deps.fs.readFile(file));
    }
    return findUndeclaredDeps(manifest, sources, CONSUMER_PROVIDED_SPECIFIERS);
}

/** Scan every engine package; returns the aggregated undeclared findings. */
export async function checkAllDeps(deps: VerifyPublishDeps): Promise<UndeclaredFinding[]> {
    const all: UndeclaredFinding[] = [];
    for (const pkg of CHIMERA_PACKAGES) {
        all.push(...(await checkPackageDeps(deps, pkg)));
    }
    return all;
}

function runPublint(
    deps: VerifyPublishDeps,
    pkg: { readonly name: string; readonly dir: string },
): RunResult {
    deps.log(`publint ${pkg.name}…`);
    return deps.run('pnpm', publintArgs(pkg.dir), { cwd: deps.repoRoot, capture: true });
}

function runPublishDryRun(
    deps: VerifyPublishDeps,
    pkg: { readonly name: string; readonly dir: string },
): RunResult {
    deps.log(`publish --dry-run ${pkg.name}…`);
    return deps.run('pnpm', publishDryRunArgs(), {
        cwd: path.join(deps.repoRoot, pkg.dir),
        capture: true,
    });
}

// ── Orchestration ──────────────────────────────────────────────────────────────

/**
 * The positive gate: build → depcheck → publint → dry-run. Returns the first failing
 * step; on an undeclared-dep finding the offenders are logged and returned for the CLI.
 */
export async function verifyPublish(
    deps: VerifyPublishDeps,
    options: VerifyPublishOptions = {},
): Promise<VerifyPublishResult> {
    try {
        if (options.skipBuild !== true) {
            deps.log('building @chimera-engine/* packages…');
            assertStepOk('build', deps.run('pnpm', ['build:packages'], { cwd: deps.repoRoot }));
        }

        deps.log('scanning every package dist for undeclared runtime dependencies…');
        const undeclared = await checkAllDeps(deps);
        if (undeclared.length > 0) {
            for (const f of undeclared) {
                deps.log(
                    `undeclared runtime dep "${f.specifier}" in ${f.pkg} ` +
                        `(from ${path.relative(deps.repoRoot, f.file)})`,
                );
            }
            return { ok: false, failedStep: 'depcheck', undeclared };
        }

        if (options.skipPublint !== true) {
            for (const pkg of CHIMERA_PACKAGES) {
                assertStepOk('publint', runPublint(deps, pkg));
            }
        }

        if (options.dryRun !== false) {
            for (const pkg of CHIMERA_PACKAGES) {
                assertStepOk('dry-run', runPublishDryRun(deps, pkg));
            }
        }

        deps.log('verify:publish — every package is publish-ready.');
        return { ok: true };
    } catch (error) {
        if (error instanceof VerifyPublishStepError) {
            deps.log(error.message);
            return { ok: false, failedStep: error.step };
        }
        throw error;
    }
}

/**
 * The negative gate: prove the depcheck FAILS on a deliberately undeclared import.
 * Returns `ok: true` only when the synthetic offender was detected; `ok: false` means
 * an undeclared dep slipped through and the gate is not trustworthy.
 */
export function verifyPublishSelfTest(deps: VerifyPublishDeps): Promise<VerifyPublishResult> {
    const manifest: PackageManifest = { name: '@chimera-engine/self-test', dependencies: {} };
    const files = new Map<string, string>([
        [
            '/self-test/dist/index.js',
            "import { something } from 'definitely-undeclared-package';\nexport {};\n",
        ],
    ]);
    const detected = findUndeclaredDeps(manifest, files).length > 0;
    if (detected) {
        deps.log('verify:publish --self-test — PASS: the depcheck detected the undeclared import.');
    } else {
        deps.log(
            'verify:publish --self-test — FAIL: an undeclared import slipped through the depcheck.',
        );
    }
    return Promise.resolve({ ok: detected });
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────
//
// Runs only when executed directly via `tsx tools/verify-publish.ts`. The `VITEST`
// guard keeps real spawnSync / disk I/O out of the unit-test surface; the body is an
// async IIFE rather than top-level `await` because tsx transforms `tools/*.ts` as
// CommonJS (the root package.json has no `"type": "module"`) and esbuild rejects
// top-level await in CJS output.

if (process.env['VITEST'] === undefined) {
    void (async (): Promise<void> => {
        const { spawnSync } = await import('node:child_process');
        const fsp = await import('node:fs/promises');

        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

        const run: RunFn = (cmd, args, opts) => {
            const result = spawnSync(cmd, [...args], {
                cwd: opts?.cwd,
                env: { ...process.env, ...(opts?.env ?? {}) },
                encoding: 'utf8',
                shell: false,
                stdio: opts?.capture === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
            });
            if (opts?.capture === true && result.stderr) process.stderr.write(result.stderr);
            return {
                status: result.status ?? 1,
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
            };
        };

        const fs: Pick<FsLike, 'readFile'> = {
            readFile: (file) => fsp.readFile(file, 'utf8'),
        };

        // Ask npm for the EXACT published file list (`npm pack --dry-run --json`), so
        // `files`-excluded paths (e.g. simulation's `__test-support__`) never reach the
        // scan. `--json` keeps stdout pure JSON: `[{ files: [{ path }], … }]`, paths
        // relative to the package dir; resolve + filter to `.js`.
        const listPublishedJsFiles: ListPublishedJsFiles = (pkgDir) => {
            const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
                cwd: pkgDir,
                encoding: 'utf8',
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 64 * 1024 * 1024,
            });
            if ((result.status ?? 1) !== 0) {
                throw new Error(
                    `npm pack --dry-run failed in ${pkgDir} (exit ${result.status ?? 1}): ${result.stderr ?? ''}`,
                );
            }
            const parsed = JSON.parse(result.stdout || '[]') as {
                files?: { path?: string }[];
            }[];
            const files = parsed[0]?.files ?? [];
            return Promise.resolve(
                files
                    .map((f) => f.path)
                    .filter((p): p is string => typeof p === 'string' && p.endsWith('.js'))
                    .map((rel) => path.join(pkgDir, rel)),
            );
        };

        const deps: VerifyPublishDeps = {
            run,
            fs,
            listPublishedJsFiles,
            log: (message) => console.log(`[verify:publish] ${message}`),
            repoRoot,
        };

        const selfTest = process.argv.includes('--self-test');
        const result = selfTest ? await verifyPublishSelfTest(deps) : await verifyPublish(deps);

        if (!result.ok) {
            console.error(
                selfTest
                    ? '[verify:publish] self-test FAILED — the gate did not detect an undeclared import.'
                    : `[verify:publish] FAILED at step "${result.failedStep ?? 'unknown'}".`,
            );
            process.exitCode = 1;
        }
    })();
}
