/**
 * tools/verify-scaffold.ts
 *
 * `verify:scaffold` — the scaffold-and-smoke gate (issue #801, F65).
 *
 * `verify:pack` proves the packed `@chimera/*` surfaces resolve. This gate proves the
 * NEXT link in the chain: that `create-chimera-game` token-substitutes those packages
 * into a genuinely BOOTABLE app — not just files that look right. It generates a game
 * OUTSIDE the workspace and runs the generated app's own unit smoke + e2e boot-smoke
 * against it, so a broken token map, a missing public `@chimera/*` export, or a renderer
 * barrel regression surfaces here as a scaffold boot failure. It doubles as an
 * end-to-end regression net for the `@chimera/*` packages.
 *
 *   1. `pnpm build:packages`          — emit every `@chimera/*` `dist/`
 *   2. `pnpm pack` per package        — one tarball per engine package
 *   3. synthesize a standalone pnpm workspace in an OS temp dir (NOT under the repo
 *      workspace): a root `package.json` declaring the repo's toolchain (minus
 *      `@chimera/*`) + `pnpm.overrides` forcing every `@chimera/*` edge onto a tarball,
 *      a `pnpm-workspace.yaml` (`apps/*`), and a `vitest.config.mts` that resolves
 *      `@chimera/*` through `node_modules` (the packed `exports`) — never source
 *   4. `create-chimera-game <probe> --out <tmp>` — scaffold the app into `<tmp>/apps/<kebab>`,
 *      then rewrite its `workspace:*` `@chimera/*` deps onto the tarballs
 *   5. `pnpm install`                 — install the tarballs + toolchain into `<tmp>`
 *   6. `pnpm --filter <app> test`     — the generated app's UNIT smoke (manifest + screen render)
 *   7. `pnpm --filter <app> test:e2e` — the generated app's Electron BOOT-smoke
 *
 * `--self-test` proves the gate bites: it drops the required renderer registration from
 * the freshly-scaffolded app (in the temp dir only — never the template) and asserts the
 * smoke run then FAILS. If the broken scaffold still passes, the self-test exits non-zero.
 *
 * Mirrors `verify:pack`'s philosophy; the local gate is authoritative (CI Actions billing
 * is blocked). Kept out of `test`/`lint` (it spawns a full scaffold + Electron run) and
 * invoked explicitly via `pnpm verify:scaffold` / `pnpm verify:scaffold:selftest`.
 *
 * Invariants upheld:
 *   #1  — a GENERATED consumer composes the acyclic, inward `@chimera/*` DAG end-to-end.
 *   #2  — lives in `tools/`; imports only node builtins + the side-effect-free `verify-shared`.
 *   #47 — the generated app resolves `@chimera/*` ONLY through public `exports` (tarballs +
 *         a node_modules-resolving vitest config), never an internal subpath.
 *   #96 — a dropped public renderer barrel/export surfaces as a scaffold smoke failure.
 */

import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
    CHIMERA_PACKAGES,
    parsePackTarballPath,
    type FsLike,
    type RunFn,
    type RunResult,
} from './verify-shared';

// Re-export the injected I/O surfaces so the gate's own test imports them from one place.
export { type FsLike, type RunFn, type RunOptions, type RunResult } from './verify-shared';

// ── Deps + result types ──────────────────────────────────────────────────────

export interface VerifyScaffoldDeps {
    readonly run: RunFn;
    readonly fs: FsLike;
    readonly log: (message: string) => void;
    /** Absolute repo root — build/pack run from each package dir under it; templates resolve here. */
    readonly repoRoot: string;
    /**
     * The repo's toolchain dependency ranges (root deps + devDeps, minus `@chimera/*`),
     * declared at the standalone root so the generated app resolves react / vitest /
     * playwright / electron / next by walking up to `<tmp>/node_modules`
     * ({@link buildStandaloneToolchainDeps}).
     */
    readonly toolchainDeps: Readonly<Record<string, string>>;
    /**
     * The repo's root `tsconfig.json` contents (JSONC, verbatim). The generated app's
     * `tsconfig.json` / `tsconfig.build.json` / `e2e/tsconfig.json` all `extends` the repo
     * root two/three levels up, so it must exist at the standalone root for vite / Playwright /
     * Next to resolve the extends chain. `extends` only merges `compilerOptions`; each app
     * config defines its own `include`, so the root's repo-relative globs are inert here.
     */
    readonly rootTsconfig: string;
}

export type VerifyScaffoldStep = 'build' | 'pack' | 'scaffold' | 'install' | 'unit' | 'e2e';

export interface VerifyScaffoldResult {
    readonly ok: boolean;
    readonly failedStep?: VerifyScaffoldStep;
}

export interface VerifyScaffoldOptions {
    /** Skip the (slow, Electron-spawning) e2e arm — used to exercise the gate cheaply. */
    readonly skipE2e?: boolean;
}

/** The throwaway game the gate scaffolds. A fixed, clearly-disposable identity. */
export const PROBE_GAME = {
    name: 'Verify Scaffold Probe',
    kebab: 'verify-scaffold-probe',
    pkg: '@chimera/verify-scaffold-probe',
} as const;

/** Thrown by a step runner on a non-zero exit so the orchestrator can report which step failed. */
class VerifyScaffoldStepError extends Error {
    constructor(
        readonly step: VerifyScaffoldStep,
        message: string,
    ) {
        super(message);
        this.name = 'VerifyScaffoldStepError';
    }
}

function assertStepOk(step: VerifyScaffoldStep, result: RunResult): void {
    if (result.status !== 0) {
        throw new VerifyScaffoldStepError(
            step,
            `verify:scaffold: step "${step}" failed (exit ${result.status})`,
        );
    }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Merge the root `dependencies` + `devDependencies` and drop every `@chimera/*` entry.
 * The remainder — the repo's toolchain + renderer peers at the exact versions the packed
 * artifacts were built against — is declared at the standalone root so the generated app
 * (which only declares `@chimera/*`) resolves them by walking up to `<tmp>/node_modules`,
 * exactly as it would by walking up to the monorepo root.
 */
export function buildStandaloneToolchainDeps(rootPkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}): Record<string, string> {
    const merged: Record<string, string> = {
        ...(rootPkg.devDependencies ?? {}),
        ...(rootPkg.dependencies ?? {}),
    };
    const out: Record<string, string> = {};
    for (const [name, range] of Object.entries(merged)) {
        if (!name.startsWith('@chimera/')) out[name] = range;
    }
    return out;
}

/**
 * `pnpm pack` rewrites each tarball's internal `workspace:*` edges to a concrete version,
 * which is unpublished — so force every `@chimera/*` resolution onto its `file:<tarball>`
 * via `pnpm.overrides`. This guarantees the DAG resolves ONLY through the packed `exports`.
 */
export function buildPnpmOverrides(
    tarballs: Readonly<Record<string, string>>,
): Record<string, string> {
    const overrides: Record<string, string> = {};
    for (const [name, tgz] of Object.entries(tarballs)) {
        overrides[name] = `file:${tgz}`;
    }
    return overrides;
}

export interface StandaloneRootManifest {
    readonly name: string;
    readonly version: string;
    readonly private: true;
    readonly devDependencies: Record<string, string>;
    readonly scripts: Record<string, string>;
    readonly pnpm: {
        readonly overrides: Record<string, string>;
        readonly onlyBuiltDependencies: readonly string[];
    };
}

/**
 * The standalone workspace-root `package.json`. Declares the toolchain, forces `@chimera/*`
 * onto the tarballs, and stubs `build:packages` to a no-op — the generated app's e2e
 * `global-setup` runs `pnpm build:packages` from this root, but the packages arrive prebuilt
 * as tarballs, so it must not (and cannot) run the engine's real `tsc` build here. The
 * `onlyBuiltDependencies` allowlist lets pnpm run electron's + esbuild's install scripts so
 * the e2e arm has a usable Electron binary + esbuild platform binary.
 */
export function buildStandaloneRootManifest(
    toolchainDeps: Readonly<Record<string, string>>,
    tarballs: Readonly<Record<string, string>>,
): StandaloneRootManifest {
    return {
        name: 'chimera-verify-scaffold-root',
        version: '0.0.0',
        private: true,
        devDependencies: { ...toolchainDeps },
        scripts: { 'build:packages': 'node -e ""' },
        pnpm: {
            overrides: buildPnpmOverrides(tarballs),
            onlyBuiltDependencies: ['electron', 'esbuild'],
        },
    };
}

/** The `pnpm-workspace.yaml` for the standalone root: the scaffolded app is the lone member. */
export function buildStandaloneWorkspaceYaml(): string {
    return 'packages:\n  - apps/*\n';
}

/**
 * Rewrite the generated app's `@chimera/*` `workspace:*` deps onto `file:<tarball>`. The
 * standalone root has no `@chimera/*` workspace members, so a surviving `workspace:*` spec
 * would make `pnpm install` reject the app; pointing each at its tarball resolves it through
 * the packed `exports`.
 */
export function rewriteAppChimeraDeps(
    rawAppPkg: string,
    tarballs: Readonly<Record<string, string>>,
): string {
    const pkg = JSON.parse(rawAppPkg) as { dependencies?: Record<string, string> };
    const deps = pkg.dependencies ?? {};
    for (const name of Object.keys(deps)) {
        const tgz = tarballs[name];
        if (name.startsWith('@chimera/') && tgz !== undefined) {
            deps[name] = `file:${tgz}`;
        }
    }
    pkg.dependencies = deps;
    return `${JSON.stringify(pkg, null, 4)}\n`;
}

/**
 * The unit-arm vitest config the generated app's `test` script loads via
 * `--config ../../vitest.config.mts`. It maps the app's OWN relative `.js` smoke imports onto
 * co-located TS source (never node_modules), and deliberately does NOT remap bare `@chimera/*`
 * specifiers — those resolve through the installed tarballs' published `exports` (the public
 * surface the gate proves), never workspace source. `@chimera/*` is INLINED (transformed by
 * vite, not externalized to Node ESM) so the packed dist's extensionless relative re-exports
 * load — exactly how the engine's own tests consume the symlinked renderer; resolution still
 * flows through `exports`, so a missing barrel still fails (Invariant #96). The one alias wires
 * the synthetic `chimera-game-registration` seam onto the app's own register.
 */
export function buildStandaloneVitestConfig(kebab: string): string {
    return `// Generated by tools/verify-scaffold.ts — standalone unit-smoke vitest config.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
    plugins: [
        {
            name: 'scaffold-prefer-ts-source',
            enforce: 'pre',
            resolveId(source, importer) {
                if (importer === undefined || !source.startsWith('.') || !source.endsWith('.js')) {
                    return null;
                }
                const importerPath = importer.split('?')[0];
                if (importerPath === undefined || !importerPath.startsWith(root)) return null;
                // Only the app's own source maps .js -> .ts/.tsx; packed deps keep their .js.
                if (importerPath.includes('node_modules')) return null;
                const base = path.resolve(path.dirname(importerPath), source).slice(0, -3);
                for (const ext of ['.ts', '.tsx']) {
                    if (existsSync(base + ext)) return base + ext;
                }
                return null;
            },
        },
    ],
    resolve: {
        alias: {
            'chimera-game-registration': path.resolve(root, 'apps/${kebab}/renderer/register.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['**/*.test.ts', '**/*.test.tsx'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.e2e-build/**'],
        server: { deps: { inline: [/@chimera\\//] } },
        globals: false,
        restoreMocks: true,
        clearMocks: true,
        testTimeout: 60_000,
    },
});
`;
}

// ── Step runners ─────────────────────────────────────────────────────────────

/** Pack every engine package into `destDir`; returns a `{ name -> tarball path }` map. */
function packAll(deps: VerifyScaffoldDeps, destDir: string): Record<string, string> {
    const tarballs: Record<string, string> = {};
    for (const pkg of CHIMERA_PACKAGES) {
        deps.log(`packing ${pkg.name}…`);
        const result = deps.run('pnpm', ['pack', '--pack-destination', destDir], {
            cwd: path.join(deps.repoRoot, pkg.dir),
            capture: true,
        });
        assertStepOk('pack', result);
        tarballs[pkg.name] = parsePackTarballPath(result.stdout, destDir);
    }
    return tarballs;
}

/** Drive the real `create-chimera-game` CLI to scaffold the probe app into `<tmp>/apps/<kebab>`. */
function scaffoldProbe(deps: VerifyScaffoldDeps, tmp: string): RunResult {
    const cli = path.join(deps.repoRoot, 'tools', 'create-chimera-game', 'index.ts');
    deps.log(`scaffolding ${PROBE_GAME.pkg} into ${tmp} via the create-chimera-game CLI…`);
    return deps.run('tsx', [cli, PROBE_GAME.name, '--out', tmp], { cwd: deps.repoRoot });
}

/**
 * Env var the generated app's e2e `global-setup`/`build-main` reads to bundle the Electron host
 * from a packed tarball install instead of repo source. Duplicated as a literal (not imported
 * from verify-pack.ts, whose CLI entry runs on import) — the same boundary reason `build-main`
 * inlines it. Pointed at the app's own `node_modules`, this drops the `@chimera/electron/main`
 * SOURCE alias (there is no `electron/` source under the standalone root) so esbuild resolves the
 * host + preload from the installed `@chimera/electron` tarball, and sets the `@chimera/*` nodePaths.
 */
const E2E_NODE_MODULES_ENV = 'CHIMERA_VERIFY_PACK_NODE_MODULES';

/** Run one of the generated app's smoke scripts (`test` or `test:e2e`) from the standalone root. */
function runAppScript(
    deps: VerifyScaffoldDeps,
    tmp: string,
    script: 'test' | 'test:e2e',
    env?: Readonly<Record<string, string>>,
): RunResult {
    deps.log(`running the generated app's "${script}" smoke…`);
    return deps.run('pnpm', ['--filter', PROBE_GAME.pkg, script], {
        cwd: tmp,
        ...(env !== undefined ? { env } : {}),
    });
}

/**
 * Drop the required renderer registration from the freshly-scaffolded app (temp dir only).
 * The blank template's `renderer/register.ts` ends with a `registerRendererGame(...)` call;
 * removing it leaves the game unregistered so the smoke run must fail. Returns false (and the
 * self-test fails loudly downstream) when there was no registration call to drop.
 */
async function dropRegistration(deps: VerifyScaffoldDeps, appDir: string): Promise<boolean> {
    const registerPath = path.join(appDir, 'renderer', 'register.ts');
    try {
        const raw = await deps.fs.readFile(registerPath);
        const broken = raw.replace(
            /^[ \t]*registerRendererGame\([^;]*\);[ \t]*$/m,
            '// registration removed by verify:scaffold --self-test',
        );
        if (broken === raw) {
            deps.log('self-test: no registerRendererGame(...) call found to drop');
            return false;
        }
        await deps.fs.writeFile(registerPath, broken);
        deps.log('self-test: dropped the renderer registration from the scaffolded app');
        return true;
    } catch {
        deps.log(`self-test: could not read ${registerPath} to break it`);
        return false;
    }
}

// ── Shared pipeline: build → pack → synthesize → scaffold → install → smoke ─────

interface PipelineHooks {
    /** Runs after the app is scaffolded + dep-rewritten, before install (used by the self-test). */
    readonly mutate?: (deps: VerifyScaffoldDeps, appDir: string) => Promise<void>;
}

/**
 * The full pipeline inside an already-created throwaway `tmp` (the caller owns `tmp` so it
 * can always clean up). Throws {@link VerifyScaffoldStepError} on the first failed step.
 */
async function scaffoldPipeline(
    deps: VerifyScaffoldDeps,
    tmp: string,
    options: VerifyScaffoldOptions,
    hooks: PipelineHooks = {},
): Promise<void> {
    const tarballsDir = path.join(tmp, 'tarballs');
    const appDir = path.join(tmp, 'apps', PROBE_GAME.kebab);
    await deps.fs.mkdir(tarballsDir);

    // 1. build
    deps.log('building @chimera/* packages…');
    assertStepOk('build', deps.run('pnpm', ['build:packages'], { cwd: deps.repoRoot }));

    // 2. pack
    const tarballs = packAll(deps, tarballsDir);

    // 3. synthesize the standalone root (manifest + workspace + unit-arm vitest config)
    await deps.fs.writeFile(
        path.join(tmp, 'package.json'),
        `${JSON.stringify(buildStandaloneRootManifest(deps.toolchainDeps, tarballs), null, 4)}\n`,
    );
    await deps.fs.writeFile(path.join(tmp, 'pnpm-workspace.yaml'), buildStandaloneWorkspaceYaml());
    await deps.fs.writeFile(
        path.join(tmp, 'vitest.config.mts'),
        buildStandaloneVitestConfig(PROBE_GAME.kebab),
    );
    // The generated app's tsconfigs `extends` the repo root from `<tmp>/apps/<kebab>`; provide it.
    await deps.fs.writeFile(path.join(tmp, 'tsconfig.json'), deps.rootTsconfig);

    // 4. scaffold via the real CLI, then rewrite the app's @chimera/* deps onto the tarballs
    assertStepOk('scaffold', scaffoldProbe(deps, tmp));
    const appPkgPath = path.join(appDir, 'package.json');
    await deps.fs.writeFile(
        appPkgPath,
        rewriteAppChimeraDeps(await deps.fs.readFile(appPkgPath), tarballs),
    );

    if (hooks.mutate !== undefined) await hooks.mutate(deps, appDir);

    // 5. install
    deps.log('installing the standalone workspace (tarballs + toolchain)…');
    assertStepOk('install', deps.run('pnpm', ['install'], { cwd: tmp }));

    // 6. unit smoke
    assertStepOk('unit', runAppScript(deps, tmp, 'test'));

    // 7. e2e boot-smoke — run in verify-pack mode so the app's build-main bundles the Electron
    //    host + preload from the installed @chimera/electron tarball (no `electron/` source exists
    //    under the standalone root). Point it at the app's own node_modules (its package.json
    //    declares the @chimera/* tarball deps that resolvePreload + the esbuild nodePaths read).
    if (options.skipE2e !== true) {
        const appNodeModules = path.join(appDir, 'node_modules');
        assertStepOk(
            'e2e',
            runAppScript(deps, tmp, 'test:e2e', { [E2E_NODE_MODULES_ENV]: appNodeModules }),
        );
    }
}

// ── Orchestration ──────────────────────────────────────────────────────────────

/**
 * The positive gate: scaffold a game out-of-workspace from the packed `@chimera/*` and run
 * its unit + e2e smoke. Cleans up the throwaway in `finally`, even on failure.
 */
export async function verifyScaffold(
    deps: VerifyScaffoldDeps,
    options: VerifyScaffoldOptions = {},
): Promise<VerifyScaffoldResult> {
    const tmp = await deps.fs.mkdtemp(path.join(tmpdir(), 'chimera-verify-scaffold-'));
    try {
        await scaffoldPipeline(deps, tmp, options);
        deps.log('verify:scaffold — the generated app scaffolded, installed, and booted clean.');
        return { ok: true };
    } catch (error) {
        if (error instanceof VerifyScaffoldStepError) {
            deps.log(error.message);
            return { ok: false, failedStep: error.step };
        }
        throw error;
    } finally {
        await deps.fs.rm(tmp);
    }
}

/**
 * The negative gate: prove the smoke run FAILS when the scaffold is broken (the required
 * renderer registration is dropped). Returns `ok: true` only when the break was detected (the
 * pipeline failed); `ok: false` means the broken scaffold still passed — the gate is not
 * biting — or a prerequisite step failed before the break could be exercised.
 */
export async function verifyScaffoldSelfTest(
    deps: VerifyScaffoldDeps,
    options: VerifyScaffoldOptions = {},
): Promise<VerifyScaffoldResult> {
    const tmp = await deps.fs.mkdtemp(path.join(tmpdir(), 'chimera-verify-scaffold-'));
    let dropped = false;
    try {
        await scaffoldPipeline(deps, tmp, options, {
            mutate: async (d, appDir) => {
                dropped = await dropRegistration(d, appDir);
            },
        });
        // The broken scaffold passed every smoke check — the gate is not guarding boot.
        deps.log(
            'verify:scaffold --self-test — FAIL: the broken scaffold still passed; the gate is not biting.',
        );
        return { ok: false };
    } catch (error) {
        if (error instanceof VerifyScaffoldStepError) {
            if (!dropped) {
                deps.log(
                    `verify:scaffold --self-test — could not run: step "${error.step}" failed before the break was applied.`,
                );
                return { ok: false, failedStep: error.step };
            }
            deps.log(
                `verify:scaffold --self-test — PASS: the gate detected the broken scaffold (step "${error.step}" failed).`,
            );
            return { ok: true };
        }
        throw error;
    } finally {
        await deps.fs.rm(tmp);
    }
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────
//
// Runs only when executed directly via `tsx tools/verify-scaffold.ts` (the
// `verify:scaffold` / `verify:scaffold:selftest` scripts). The `VITEST` guard keeps the real
// spawnSync / disk I/O out of the unit-test surface, matching the sibling tools. The body is
// an async IIFE rather than top-level await: tsx transforms `tools/*.ts` as CommonJS (the root
// package.json has no `"type": "module"`), and esbuild rejects top-level await in CJS output.

if (process.env['VITEST'] === undefined) {
    void (async (): Promise<void> => {
        const { spawnSync } = await import('node:child_process');
        const fsp = await import('node:fs/promises');

        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const rootPkg = JSON.parse(
            await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
        ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        // Read verbatim (JSONC): the standalone root re-emits it so the app's `extends` resolves.
        const rootTsconfig = await fsp.readFile(path.join(repoRoot, 'tsconfig.json'), 'utf8');

        // Scrub ELECTRON_RUN_AS_NODE from the gate's own spawn env: when a shell / CI runner /
        // agent sandbox exports it, the e2e arm's Electron binary boots as plain Node and rejects
        // Playwright's Chromium flags. (The generated fixture also strips it; belt and suspenders.)
        const baseEnv: Record<string, string | undefined> = { ...process.env };
        delete baseEnv['ELECTRON_RUN_AS_NODE'];

        const run: RunFn = (cmd, args, opts) => {
            const result = spawnSync(cmd, [...args], {
                cwd: opts?.cwd,
                env: { ...baseEnv, ...(opts?.env ?? {}) },
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

        const deps: VerifyScaffoldDeps = {
            run,
            fs,
            log: (message) => console.log(`[verify:scaffold] ${message}`),
            repoRoot,
            toolchainDeps: buildStandaloneToolchainDeps(rootPkg),
            rootTsconfig,
        };

        const selfTest = process.argv.includes('--self-test');
        const result = selfTest ? await verifyScaffoldSelfTest(deps) : await verifyScaffold(deps);

        if (!result.ok) {
            console.error(
                selfTest
                    ? '[verify:scaffold] self-test FAILED — the gate did not detect a broken scaffold.'
                    : `[verify:scaffold] FAILED at step "${result.failedStep ?? 'unknown'}".`,
            );
            process.exitCode = 1;
        }
    })();
}
