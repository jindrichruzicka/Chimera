/**
 * tools/verify-pack.ts
 *
 * `verify:pack` — the release-gating TRUE-ARTIFACT validation step (issue #794, F64 T2).
 *
 * Day-to-day, `apps/tactics` consumes the `@chimera/*` packages through pnpm
 * `workspace:*` symlinks, which resolve the WHOLE source tree regardless of what
 * each package actually publishes. That masks a class of packaging bug: a missing
 * `exports` subpath or `files` entry works fine locally but breaks a real consumer
 * who only ever sees the published surface.
 *
 * This driver validates the real packaged artifact instead of the symlinks:
 *
 *   1. `pnpm build:packages`         — emit every `@chimera/*` `dist/` (+ renderer CSS copy)
 *   2. `pnpm pack` per package       — produce one tarball per engine package
 *   3. synthesize a throwaway consumer OUTSIDE the workspace — `file:` deps + npm
 *      `overrides` so EVERY `@chimera/*` edge resolves through a tarball's `exports`
 *      (no `workspace:*` reach-through; the gate's whole point)
 *   4. `npm install`                 — install the tarballs into the throwaway
 *   5. renderer-barrel resolution probe — assert the renderer's two public barrels
 *      (`./components/ui`, `./components/chat`), the `./game` seam, the `./styles/*.css`
 *      surface, and electron's `./main` + `./preload/api` resolve from the tarball
 *      (Invariant #96) — a missing `exports`/`files` entry makes `require.resolve` throw
 *   6. scoped Playwright E2E         — run the tactics suite with the four library
 *      packages + the electron host/preload bundled FROM the throwaway tarballs (the
 *      `CHIMERA_VERIFY_PACK_NODE_MODULES` flag flips global-setup's esbuild resolution)
 *
 * `--self-test` proves the gate actually bites: it drops a required `exports` entry
 * from a freshly-installed tarball (in the temp dir only — never the repo) and asserts
 * the probe then FAILS. If the broken surface slips through, the self-test exits non-zero.
 *
 * The renderer GUI shell (`renderer/out`) stays source-built: `renderer/next.config.ts`
 * deliberately resolves the renderer barrels + game registry onto source for
 * single-instance EscapeStack / Zustand / registry identity, so the packed renderer
 * surface is gate-checked by the import probe (step 5) rather than re-rendered.
 *
 * Invariants upheld:
 *   #1  — the acyclic, inward package DAG survives packaging (npm resolves the tarball
 *         graph in dependency order); validated end-to-end against the real artifact.
 *   #2  — lives in `tools/`; imports only node builtins — never a package or app module.
 *   #47 — orchestration resolves ONLY through each package's public `exports`, never an
 *         internal subpath (no `workspace:*` symlink fallback inside the throwaway).
 *   #96 — the probe catches a missing `exports`/`files` entry for the renderer's two
 *         public component barrels.
 *
 * Usage (run via `pnpm verify:pack` / `pnpm verify:pack:selftest`, not in unit tests):
 *   tsx tools/verify-pack.ts            # positive gate
 *   tsx tools/verify-pack.ts --self-test  # negative gate (must detect a dropped entry)
 */

import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ── Injected I/O surfaces (kept narrow so unit tests need no real process / disk) ──

export interface RunResult {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

export interface RunOptions {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    /** Capture stdout (for parsing `pnpm pack` output) instead of inheriting the TTY. */
    readonly capture?: boolean;
}

/** Synchronous command runner (spawnSync-shaped); injected so tests spawn nothing. */
export type RunFn = (cmd: string, args: readonly string[], opts?: RunOptions) => RunResult;

/** Minimal async filesystem surface; injected so tests touch no real disk. */
export interface FsLike {
    mkdtemp(prefix: string): Promise<string>;
    mkdir(dir: string): Promise<void>;
    rm(dir: string): Promise<void>;
    writeFile(file: string, data: string): Promise<void>;
    readFile(file: string): Promise<string>;
    exists(p: string): Promise<boolean>;
}

export interface VerifyPackDeps {
    readonly run: RunFn;
    readonly fs: FsLike;
    readonly log: (message: string) => void;
    /** Absolute repo root — pack runs from each package dir under it; E2E runs from it. */
    readonly repoRoot: string;
    /** Renderer peer ranges read from the root package.json (`readPeerVersions`). */
    readonly peerVersions: Readonly<Record<string, string>>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * The five engine packages, in inward dependency order (`simulation` is the
 * zero-dep leaf). `apps/tactics` is the CONSUMER that exercises them, never a
 * packed artifact, so it is deliberately absent.
 */
export const CHIMERA_PACKAGES = [
    { name: '@chimera/simulation', dir: 'simulation' },
    { name: '@chimera/ai', dir: 'ai' },
    { name: '@chimera/networking', dir: 'networking' },
    { name: '@chimera/renderer', dir: 'renderer' },
    { name: '@chimera/electron', dir: 'electron' },
] as const;

/**
 * Renderer `peerDependencies` the throwaway consumer must install so the packed
 * renderer surface resolves like a real consumer's (and npm does not auto-pick
 * mismatched majors). Versions come from the root package.json at runtime.
 */
export const RENDERER_PEERS = [
    'next',
    'react',
    'react-dom',
    'three',
    '@react-three/fiber',
] as const;

/**
 * Env var the tactics E2E `global-setup` reads to flip esbuild `@chimera/*`
 * resolution off the workspace symlinks and onto the throwaway tarball install.
 */
export const E2E_NODE_MODULES_ENV = 'CHIMERA_VERIFY_PACK_NODE_MODULES';

/** Public subpaths the resolution probe asserts ship in the packed surface. */
const PROBE_SUBPATHS = [
    '@chimera/renderer/components/ui',
    '@chimera/renderer/components/chat',
    '@chimera/renderer/game',
    // F65 Phase 2c: a consumer app's per-app Next host re-exports the engine shell
    // from `@chimera/renderer/shell/*`; probe a representative route + the root layout
    // so a missing `dist/app/*` entry in the packed artifact fails the gate.
    '@chimera/renderer/shell/layout',
    '@chimera/renderer/shell/main-menu/page',
    '@chimera/renderer/styles/tokens.css',
    '@chimera/electron/main',
    '@chimera/electron/preload/api',
    '@chimera/electron/preload/api-types',
] as const;

// ── Result + step-error types ────────────────────────────────────────────────

export type VerifyPackStep = 'build' | 'pack' | 'install' | 'probe' | 'e2e';

export interface VerifyPackResult {
    readonly ok: boolean;
    readonly failedStep?: VerifyPackStep;
    readonly tarballs?: Readonly<Record<string, string>>;
}

export interface ConsumerManifest {
    readonly name: string;
    readonly private: true;
    readonly version: string;
    readonly dependencies: Record<string, string>;
    readonly overrides: Record<string, string>;
}

export interface VerifyPackOptions {
    /** Skip the (slow, Electron-spawning) E2E run — used to exercise the gate cheaply. */
    readonly skipE2e?: boolean;
}

export interface VerifyPackSelfTestOptions {
    /** The package + `exports` subpath to drop from the packed surface (default: renderer ui). */
    readonly target?: { readonly pkg: string; readonly subpath: string };
}

/** Thrown by a step runner on a non-zero exit so `verifyPack` can report which step failed. */
class VerifyPackStepError extends Error {
    constructor(
        readonly step: VerifyPackStep,
        message: string,
    ) {
        super(message);
        this.name = 'VerifyPackStepError';
    }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the tarball path from `pnpm pack` stdout. With `--pack-destination`,
 * pnpm prints the created tarball path; we take the last `.tgz` line (ignoring
 * any notices) and resolve a bare filename against the destination dir.
 */
export function parsePackTarballPath(stdout: string, destDir: string): string {
    const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const tgzLine = [...lines].reverse().find((line) => line.endsWith('.tgz'));
    if (tgzLine === undefined) {
        throw new Error('verify:pack: could not find a *.tgz path in `pnpm pack` output');
    }
    return path.isAbsolute(tgzLine) ? tgzLine : path.join(destDir, tgzLine);
}

/** Read the renderer peer ranges from the root package.json (devDeps + deps merged). */
export function readPeerVersions(rootPkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}): Record<string, string> {
    const merged: Record<string, string> = {
        ...(rootPkg.devDependencies ?? {}),
        ...(rootPkg.dependencies ?? {}),
    };
    const versions: Record<string, string> = {};
    for (const peer of RENDERER_PEERS) {
        const range = merged[peer];
        if (range !== undefined) versions[peer] = range;
    }
    return versions;
}

/**
 * Synthesize the throwaway consumer `package.json`. Every `@chimera/*` package is a
 * `file:` tarball dep AND an `overrides` entry, so the tarballs' own internal
 * `workspace:*` edges (ai→sim, networking→sim, renderer→sim, electron→all four) are
 * forced onto the packed artifacts — guaranteeing resolution flows ONLY through each
 * package's published `exports`, with no `workspace:*` spec surviving anywhere.
 */
export function buildConsumerManifest(
    tarballs: Readonly<Record<string, string>>,
    peerVersions: Readonly<Record<string, string>>,
): ConsumerManifest {
    const dependencies: Record<string, string> = {};
    const overrides: Record<string, string> = {};
    for (const [name, tgz] of Object.entries(tarballs)) {
        dependencies[name] = `file:${tgz}`;
        overrides[name] = `file:${tgz}`;
    }
    for (const [peer, range] of Object.entries(peerVersions)) {
        dependencies[peer] = range;
    }
    return {
        name: 'chimera-verify-pack-consumer',
        private: true,
        version: '0.0.0',
        dependencies,
        overrides,
    };
}

/**
 * The resolution probe, emitted as an ESM script run from the throwaway consumer
 * (so `createRequire` resolves bare `@chimera/*` specifiers through the installed
 * tarballs only). Resolution + existence is deliberate: the renderer barrels import
 * React/Three and CSS Modules, which plain Node cannot execute — but `require.resolve`
 * exercises exactly the `exports`/`files` surface Invariant #96 guards, and throws
 * the moment a subpath is missing.
 */
export function buildProbeScript(): string {
    const subpaths = JSON.stringify([...PROBE_SUBPATHS], null, 4);
    return `// Generated by tools/verify-pack.ts — true-artifact resolution probe.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const subpaths = ${subpaths};

let failed = false;
for (const subpath of subpaths) {
    try {
        const resolved = require.resolve(subpath);
        if (!existsSync(resolved)) {
            console.error('verify:pack probe — MISSING FILE (files gap): ' + subpath + ' -> ' + resolved);
            failed = true;
        } else {
            console.log('verify:pack probe — ok: ' + subpath);
        }
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
        console.error('verify:pack probe — UNRESOLVED EXPORT (exports gap): ' + subpath + ' [' + code + ']');
        failed = true;
    }
}

if (failed) {
    console.error('verify:pack probe — FAILED: the packed surface is missing a required entry.');
    process.exit(1);
}
console.log('verify:pack probe — all public subpaths resolved from the packed artifact.');
`;
}

/** Playwright argv for the scoped, debug-excluded tactics E2E run against the artifact. */
export function e2ePlaywrightArgs(): string[] {
    return [
        'test',
        '--config=apps/tactics/e2e/playwright.config.ts',
        '--project=electron-e2e',
        // The Runtime Debug Layer preload (`./preload/debug-api`) is intentionally NOT a
        // public `@chimera/electron` export (Invariant #27), so exclude the debug specs.
        '--grep-invert',
        'debug',
    ];
}

// ── Step runners (each returns a RunResult or throws VerifyPackStepError) ─────────

function assertStepOk(step: VerifyPackStep, result: RunResult): void {
    if (result.status !== 0) {
        throw new VerifyPackStepError(
            step,
            `verify:pack: step "${step}" failed (exit ${result.status})`,
        );
    }
}

/** Pack one engine package into `destDir`; returns its tarball path. */
export async function packPackage(
    deps: VerifyPackDeps,
    pkg: { readonly name: string; readonly dir: string },
    destDir: string,
): Promise<string> {
    deps.log(`packing ${pkg.name}…`);
    const result = deps.run('pnpm', ['pack', '--pack-destination', destDir], {
        cwd: path.join(deps.repoRoot, pkg.dir),
        capture: true,
    });
    assertStepOk('pack', result);
    return Promise.resolve(parsePackTarballPath(result.stdout, destDir));
}

/** Pack every engine package; returns a `{ name -> tarball path }` map. */
export async function packAll(
    deps: VerifyPackDeps,
    destDir: string,
): Promise<Record<string, string>> {
    const tarballs: Record<string, string> = {};
    for (const pkg of CHIMERA_PACKAGES) {
        tarballs[pkg.name] = await packPackage(deps, pkg, destDir);
    }
    return tarballs;
}

/** Install the tarballs into the throwaway consumer (no workspace ancestor → no symlinks). */
function installTarballs(deps: VerifyPackDeps, consumerDir: string, cacheDir: string): RunResult {
    deps.log('installing tarballs into the throwaway consumer…');
    return deps.run(
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cacheDir],
        { cwd: consumerDir },
    );
}

/** Write + run the renderer/electron resolution probe from the throwaway consumer. */
async function runProbe(deps: VerifyPackDeps, consumerDir: string): Promise<RunResult> {
    await deps.fs.writeFile(path.join(consumerDir, 'probe.mjs'), buildProbeScript());
    deps.log('running the renderer-barrel resolution probe against the packed artifact…');
    return deps.run('node', ['probe.mjs'], { cwd: consumerDir });
}

/** Run the scoped Playwright E2E suite with `@chimera/*` resolved from the tarballs. */
function runE2e(deps: VerifyPackDeps, consumerNodeModules: string): RunResult {
    deps.log('running the tactics E2E suite against the packed artifact…');
    return deps.run('pnpm', ['exec', 'playwright', ...e2ePlaywrightArgs()], {
        cwd: deps.repoRoot,
        env: { [E2E_NODE_MODULES_ENV]: consumerNodeModules },
    });
}

/**
 * Drop a required `exports` subpath from an INSTALLED tarball (in the throwaway only,
 * never the repo) so the probe should then fail. Best-effort: if the installed
 * manifest cannot be read, returns false and the self-test fails loudly downstream.
 */
async function breakInstalledExport(
    deps: VerifyPackDeps,
    consumerNodeModules: string,
    pkgName: string,
    subpath: string,
): Promise<boolean> {
    const manifestPath = path.join(consumerNodeModules, pkgName, 'package.json');
    try {
        const raw = await deps.fs.readFile(manifestPath);
        const manifest = JSON.parse(raw) as { exports?: Record<string, unknown> };
        const exportsMap = manifest.exports;
        if (exportsMap?.[subpath] === undefined) {
            deps.log(`self-test: ${pkgName} has no "${subpath}" export to drop`);
            return false;
        }
        delete exportsMap[subpath];
        await deps.fs.writeFile(manifestPath, JSON.stringify(manifest, null, 4));
        deps.log(`self-test: dropped "${subpath}" from the installed ${pkgName} surface`);
        return true;
    } catch {
        deps.log(`self-test: could not read ${manifestPath} to break it`);
        return false;
    }
}

// ── Shared setup: build → pack → manifest → install ──────────────────────────

interface ConsumerSetup {
    readonly consumerDir: string;
    readonly consumerNodeModules: string;
    readonly tarballs: Record<string, string>;
}

/**
 * Build → pack → write manifest → install, inside an already-created throwaway
 * `tmp`. The caller owns `tmp` so it can always clean up — even when a step here
 * throws before this returns.
 */
async function buildPackInstall(deps: VerifyPackDeps, tmp: string): Promise<ConsumerSetup> {
    const tarballsDir = path.join(tmp, 'tarballs');
    const consumerDir = path.join(tmp, 'consumer');
    const consumerNodeModules = path.join(consumerDir, 'node_modules');
    const cacheDir = path.join(tmp, 'npm-cache');
    await deps.fs.mkdir(tarballsDir);
    await deps.fs.mkdir(consumerDir);

    deps.log('building @chimera/* packages…');
    assertStepOk('build', deps.run('pnpm', ['build:packages'], { cwd: deps.repoRoot }));

    const tarballs = await packAll(deps, tarballsDir);

    const manifest = buildConsumerManifest(tarballs, deps.peerVersions);
    await deps.fs.writeFile(
        path.join(consumerDir, 'package.json'),
        JSON.stringify(manifest, null, 4),
    );

    assertStepOk('install', installTarballs(deps, consumerDir, cacheDir));

    return { consumerDir, consumerNodeModules, tarballs };
}

// ── Orchestration ──────────────────────────────────────────────────────────────

/**
 * The positive gate: build → pack → install → probe → scoped E2E against the real
 * packaged artifact. Cleans up the throwaway in `finally`, even on failure.
 */
export async function verifyPack(
    deps: VerifyPackDeps,
    options: VerifyPackOptions = {},
): Promise<VerifyPackResult> {
    const tmp = await deps.fs.mkdtemp(path.join(tmpdir(), 'chimera-verify-pack-'));
    try {
        const setup = await buildPackInstall(deps, tmp);

        assertStepOk('probe', await runProbe(deps, setup.consumerDir));

        if (options.skipE2e !== true) {
            assertStepOk('e2e', runE2e(deps, setup.consumerNodeModules));
        }

        deps.log('verify:pack — the real packaged artifact passed every check.');
        return { ok: true, tarballs: setup.tarballs };
    } catch (error) {
        if (error instanceof VerifyPackStepError) {
            deps.log(error.message);
            return { ok: false, failedStep: error.step };
        }
        throw error;
    } finally {
        await deps.fs.rm(tmp);
    }
}

/**
 * The negative gate: prove the probe FAILS when a required `exports` entry is dropped
 * from the packed surface. Returns `ok: true` only when the dropped entry was detected
 * (probe non-zero); `ok: false` means the broken surface slipped through (or a
 * prerequisite step failed) — either way the gate is not trustworthy.
 */
export async function verifyPackSelfTest(
    deps: VerifyPackDeps,
    options: VerifyPackSelfTestOptions = {},
): Promise<VerifyPackResult> {
    const target = options.target ?? { pkg: '@chimera/renderer', subpath: './components/ui' };
    const tmp = await deps.fs.mkdtemp(path.join(tmpdir(), 'chimera-verify-pack-'));
    try {
        const setup = await buildPackInstall(deps, tmp);

        await breakInstalledExport(deps, setup.consumerNodeModules, target.pkg, target.subpath);

        const probe = await runProbe(deps, setup.consumerDir);
        const detected = probe.status !== 0;
        if (detected) {
            deps.log(
                `verify:pack --self-test — PASS: the gate detected the dropped "${target.subpath}" export.`,
            );
        } else {
            deps.log(
                `verify:pack --self-test — FAIL: the probe still passed after dropping "${target.subpath}" — the gate is not guarding the public surface.`,
            );
        }
        return { ok: detected };
    } catch (error) {
        if (error instanceof VerifyPackStepError) {
            deps.log(`verify:pack --self-test — could not run: ${error.message}`);
            return { ok: false, failedStep: error.step };
        }
        throw error;
    } finally {
        await deps.fs.rm(tmp);
    }
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────
//
// Runs only when executed directly via `tsx tools/verify-pack.ts` (the
// `verify:pack` / `verify:pack:selftest` scripts). The `VITEST` guard keeps the
// real spawnSync / disk I/O out of the unit-test surface, matching the sibling
// tools. The body is an async IIFE rather than top-level `await`: tsx transforms
// `tools/*.ts` as CommonJS (the root package.json has no `"type": "module"`), and
// esbuild rejects top-level await in CJS output.

if (process.env['VITEST'] === undefined) {
    void (async (): Promise<void> => {
        const { spawnSync } = await import('node:child_process');
        const fsp = await import('node:fs/promises');

        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const rootPkg = JSON.parse(
            await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
        ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

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

        const fs: FsLike = {
            mkdtemp: (prefix) => fsp.mkdtemp(prefix),
            mkdir: (dir) => fsp.mkdir(dir, { recursive: true }).then(() => undefined),
            rm: (dir) => fsp.rm(dir, { recursive: true, force: true }),
            writeFile: (file, data) => fsp.writeFile(file, data, 'utf8'),
            readFile: (file) => fsp.readFile(file, 'utf8'),
            exists: (p) =>
                fsp.access(p).then(
                    () => true,
                    () => false,
                ),
        };

        const deps: VerifyPackDeps = {
            run,
            fs,
            log: (message) => console.log(`[verify:pack] ${message}`),
            repoRoot,
            peerVersions: readPeerVersions(rootPkg),
        };

        const selfTest = process.argv.includes('--self-test');
        const result = selfTest ? await verifyPackSelfTest(deps) : await verifyPack(deps);

        if (!result.ok) {
            console.error(
                selfTest
                    ? '[verify:pack] self-test FAILED — the gate did not detect a dropped public-surface entry.'
                    : `[verify:pack] FAILED at step "${result.failedStep ?? 'unknown'}".`,
            );
            process.exitCode = 1;
        }
    })();
}
