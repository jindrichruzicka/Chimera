/**
 * tools/verify-scaffold.ts
 *
 * `verify:scaffold` — the scaffold-and-smoke gate.
 *
 * `verify:pack` proves the packed `@chimera-engine/*` surfaces resolve. This gate proves the
 * NEXT link in the chain: that `create-chimera-game` token-substitutes those packages
 * into a genuinely BOOTABLE app — not just files that look right. It generates a game
 * OUTSIDE the workspace and runs the generated app's own unit smoke + e2e boot-smoke
 * against it, so a broken token map, a missing public `@chimera-engine/*` export, or a renderer
 * barrel regression surfaces here as a scaffold boot failure. It doubles as an
 * end-to-end regression net for the `@chimera-engine/*` packages.
 *
 *   1. `pnpm build:packages`          — emit every `@chimera-engine/*` `dist/`
 *   2. `pnpm pack` per package        — one tarball per engine package
 *   3. `create-chimera-game <probe> --out <tmp>` — the CLI EMITS the whole standalone project into
 *      the temp dir: the app at `<tmp>/apps/<kebab>` PLUS the project root it ships (a toolchain
 *      `package.json`, `pnpm-workspace.yaml`, a `node_modules`-resolving `vitest.config.mts`, and
 *      a `tsconfig.json` carrying the frozen root `compilerOptions`). The gate verifies the EXACT
 *      bytes the published CLI emits — it no longer synthesizes the root itself.
 *   4. layer the gate's `pnpm.overrides` onto the CLI-emitted root + rewrite the app's `@chimera-engine/*`
 *      deps onto the packed tarballs, so the whole DAG resolves through the locally-built
 *      artifacts instead of the (unpublished) npm ranges the CLI emitted
 *   5. `pnpm install`                 — install the tarballs + toolchain into `<tmp>`
 *   6. `pnpm --filter <app> test`     — the generated app's UNIT smoke (manifest + screen render)
 *   7. `pnpm --filter <app> test:e2e` — the generated app's Electron BOOT-smoke
 *   8. `pnpm --filter <app> build` + `build:app` — the PRODUCTION build: `tsc -p tsconfig.build.json`
 *      (proves the standalone refs rewrite resolves the engine from `node_modules`) + the esbuild
 *      main/preload bundles. This is the arm that fails out-of-repo.
 *   9. `next build` the renderer + an UNSIGNED `electron-builder --dir` — proves the tokenised
 *      packaging config produces a branded local app bundle from the standalone-emitted project.
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
 *   #1  — a GENERATED consumer composes the acyclic, inward `@chimera-engine/*` DAG end-to-end.
 *   #2  — lives in `tools/`; imports node builtins + the side-effect-free `verify-shared` and the
 *         sibling `create-chimera-game/standalone` pure synthesizers (no `@chimera-engine/*`).
 *   #47 — the generated app resolves `@chimera-engine/*` ONLY through public `exports` (tarballs +
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
// The standalone-root synthesizers are owned by create-chimera-game (the single author of the
// shape the published CLI emits). The gate consumes them and layers tarball overrides on top
// (applyTarballOverrides below), so it verifies the exact bytes the CLI ships.
import { type StandaloneRootManifest } from './create-chimera-game/standalone';

// Re-export the injected I/O surfaces so the gate's own test imports them from one place.
export { type FsLike, type RunFn, type RunOptions, type RunResult } from './verify-shared';

// ── Deps + result types ──────────────────────────────────────────────────────

export interface VerifyScaffoldDeps {
    readonly run: RunFn;
    readonly fs: FsLike;
    readonly log: (message: string) => void;
    /**
     * Absolute repo root — build/pack run from each package dir under it, and the
     * `create-chimera-game` CLI is invoked from here. (The CLI resolves its bundled templates
     * package-relative to its own code, not from this root — see {@link resolveTemplatesRoot}.)
     */
    readonly repoRoot: string;
}

export type VerifyScaffoldStep =
    | 'build'
    | 'pack'
    | 'scaffold'
    | 'install'
    | 'unit'
    | 'e2e'
    | 'prod-build'
    | 'dev-harness'
    | 'package';

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
    pkg: '@chimera-engine/verify-scaffold-probe',
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

// ── Pure helpers (gate-owned: tarball/override concerns) ─────────────────────────

/**
 * `pnpm pack` rewrites each tarball's internal `workspace:*` edges to a concrete version,
 * which is unpublished — so force every `@chimera-engine/*` resolution onto its `file:<tarball>`
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

/**
 * Layer the gate's tarball overrides onto the published-form standalone root manifest. The
 * create-chimera-game CLI emits a root whose `@chimera-engine/*` edges resolve from npm (no overrides);
 * the gate re-resolves every edge onto its packed `file:<tarball>` so it verifies the EXACT bytes
 * the CLI ships against the locally-built (unpublished) artifacts. Pure; `overrides` is placed
 * first to mirror the historical key order. The input is always the published (override-free)
 * form, so the spread of the rest of `pnpm` never clobbers the tarball overrides.
 */
export function applyTarballOverrides(
    manifest: StandaloneRootManifest,
    tarballs: Readonly<Record<string, string>>,
): StandaloneRootManifest {
    return {
        ...manifest,
        pnpm: {
            overrides: buildPnpmOverrides(tarballs),
            ...manifest.pnpm,
        },
    };
}

/**
 * Rewrite the generated app's `@chimera-engine/*` `workspace:*` deps onto `file:<tarball>`. The
 * standalone root has no `@chimera-engine/*` workspace members, so a surviving `workspace:*` spec
 * would make `pnpm install` reject the app; pointing each at its tarball resolves it through
 * the packed `exports`. Rewrites BOTH `dependencies` and `devDependencies`: the blank template
 * carries the engine packages under `devDependencies` (esbuild-inlined, kept out of
 * electron-builder's prod tree), so a section-blind rewrite would leave a `workspace:*` the
 * gate's `pnpm install` then rejects. The root `pnpm.overrides` may already mask this, but this
 * function's own contract must hold regardless.
 */
export function rewriteAppChimeraDeps(
    rawAppPkg: string,
    tarballs: Readonly<Record<string, string>>,
): string {
    const pkg = JSON.parse(rawAppPkg) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    const rewriteSection = (section: Record<string, string> | undefined): void => {
        if (section === undefined) return;
        for (const name of Object.keys(section)) {
            const tgz = tarballs[name];
            if (name.startsWith('@chimera-engine/') && tgz !== undefined) {
                section[name] = `file:${tgz}`;
            }
        }
    };
    rewriteSection(pkg.dependencies);
    rewriteSection(pkg.devDependencies);
    return `${JSON.stringify(pkg, null, 4)}\n`;
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
 * Extract + shape-check the `chimera-dev-mp --dry-run` spawn plan from captured
 * stdout (pnpm prefixes script output with its banner, so the JSON is sliced
 * between the first `{` and the last `}`). Throws a {@link VerifyScaffoldStepError}
 * for the `dev-harness` step on any parse/shape failure.
 */
function assertDryRunReport(stdout: string): void {
    const fail = (reason: string): never => {
        throw new VerifyScaffoldStepError(
            'dev-harness',
            `verify:scaffold: step "dev-harness" ${reason}`,
        );
    };
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end <= start) {
        fail('printed no spawn-plan JSON');
    }
    let report: { players?: unknown; entry?: unknown; instances?: unknown };
    try {
        report = JSON.parse(stdout.slice(start, end + 1)) as typeof report;
    } catch {
        return fail('printed unparseable spawn-plan JSON');
    }
    if (report.players !== 2) {
        fail(`planned ${String(report.players)} players instead of 2`);
    }
    if (typeof report.entry !== 'string' || !report.entry.endsWith('.js')) {
        fail('resolved no built app entry');
    }
    const instances = report.instances;
    if (!Array.isArray(instances) || instances.length !== 2) {
        fail('planned the wrong instance count');
    }
    const host = (instances as { args?: readonly string[] }[])[0];
    if (!(host?.args ?? []).includes('--dev-auto-host')) {
        fail('planned no auto-hosting first instance');
    }
}

/** Run one of the generated app's smoke scripts (`test` or `test:e2e`) from the standalone root. */
function runAppScript(
    deps: VerifyScaffoldDeps,
    tmp: string,
    script: 'test' | 'test:e2e',
): RunResult {
    deps.log(`running the generated app's "${script}" smoke…`);
    return deps.run('pnpm', ['--filter', PROBE_GAME.pkg, script], { cwd: tmp });
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
    deps.log('building @chimera-engine/* packages…');
    assertStepOk('build', deps.run('pnpm', ['build:packages'], { cwd: deps.repoRoot }));

    // 2. pack
    const tarballs = packAll(deps, tarballsDir);

    // 3. scaffold via the real CLI in standalone `--out` mode: it EMITS the whole project root
    //    (package.json toolchain manifest, pnpm-workspace.yaml, vitest.config.mts, tsconfig.json)
    //    AND the app. The gate verifies the EXACT bytes the CLI ships — it no longer synthesizes
    //    the root itself.
    assertStepOk('scaffold', scaffoldProbe(deps, tmp));

    // 4. layer tarball overrides onto the CLI-emitted root, and rewrite the app's @chimera-engine/* deps
    //    onto the packed tarballs, so the whole DAG resolves through the locally-built artifacts
    //    instead of the (unpublished) npm ranges the CLI emitted.
    const rootPkgPath = path.join(tmp, 'package.json');
    const emittedRoot = JSON.parse(await deps.fs.readFile(rootPkgPath)) as StandaloneRootManifest;
    await deps.fs.writeFile(
        rootPkgPath,
        `${JSON.stringify(applyTarballOverrides(emittedRoot, tarballs), null, 4)}\n`,
    );
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

    // 7. e2e boot-smoke. The EMITTED app's `test:e2e` script self-sets
    //    `CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules` (via cross-env), so build-main bundles the
    //    Electron host + preload from the app's own installed `@chimera-engine/electron` (no monorepo
    //    `electron/` source exists here). The gate passes no env of its own — it validates exactly
    //    the shipped script behaviour.
    if (options.skipE2e !== true) {
        assertStepOk('e2e', runAppScript(deps, tmp, 'test:e2e'));
    }

    // 8. production build. `build` runs `tsc -p tsconfig.build.json`: out-of-repo it only
    //    succeeds because the standalone emit neutralised the template's monorepo `references` (the
    //    engine now resolves from `node_modules`). `build:app` esbuild-bundles main/preload — the
    //    EMITTED script self-sets `CHIMERA_VERIFY_PACK_NODE_MODULES`, so the host resolves from the
    //    installed `@chimera-engine/electron`, not absent monorepo source.
    deps.log('production-building the generated app (tsc + app bundle)…');
    assertStepOk(
        'prod-build',
        deps.run('pnpm', ['--filter', PROBE_GAME.pkg, 'build'], { cwd: tmp }),
    );
    assertStepOk(
        'prod-build',
        deps.run('pnpm', ['--filter', PROBE_GAME.pkg, 'build:app'], { cwd: tmp }),
    );

    // 8b. dev-harness dry run (§4.32): the packaged `chimera-dev-mp` bin must resolve from
    //    the standalone install (via the app's `dev:mp` script) and produce a valid spawn
    //    plan against the just-built app entry. `--dry-run` spawns no Electron — the gate
    //    stays CI-cheap; the plan JSON is extracted from under pnpm's script banner and
    //    shape-checked so a bin that "succeeds" without planning still fails the step.
    deps.log('dry-running the dev multiplayer harness (chimera-dev-mp --dry-run)…');
    const devHarnessDryRun = deps.run(
        'pnpm',
        ['--filter', PROBE_GAME.pkg, 'dev:mp', '2', '--dry-run'],
        { cwd: tmp, capture: true },
    );
    assertStepOk('dev-harness', devHarnessDryRun);
    assertDryRunReport(devHarnessDryRun.stdout);

    // 9. package. Export the Next renderer (populates `renderer/out`), then build an UNSIGNED
    //    `electron-builder --dir` bundle from the standalone-emitted project. electron-builder
    //    validates + consumes the per-game top-level `icon`, so a missing/invalid icon fails here.
    //    `--dir` skips dmg/nsis/AppImage (no python, CI-feasible — signing stays out of scope).
    deps.log('packaging the generated app (electron-builder --dir, unsigned)…');
    assertStepOk(
        'package',
        deps.run('pnpm', ['exec', 'next', 'build', `apps/${PROBE_GAME.kebab}/renderer`], {
            cwd: tmp,
        }),
    );
    // `exec electron-builder --dir` (NOT `run package -- --dir`): pnpm's `--` separator is forwarded
    // to the script verbatim, so `run package -- --dir` becomes `electron-builder -- --dir` — yargs
    // then treats `--dir` as a positional and electron-builder builds the DEFAULT targets (incl. the
    // dmg, which shells out to python). `exec` passes `--dir` as a real flag → dir-only, python-free.
    // It reads the same app `electron-builder.yml`; the app's `package` script stays the real
    // distributable flow.
    assertStepOk(
        'package',
        deps.run('pnpm', ['--filter', PROBE_GAME.pkg, 'exec', 'electron-builder', '--dir'], {
            cwd: tmp,
        }),
    );
    if (!(await deps.fs.exists(path.join(appDir, 'release')))) {
        throw new VerifyScaffoldStepError(
            'package',
            'verify:scaffold: step "package" produced no <app>/release bundle',
        );
    }
}

// ── Orchestration ──────────────────────────────────────────────────────────────

/**
 * The positive gate: scaffold a game out-of-workspace from the packed `@chimera-engine/*` and run
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
