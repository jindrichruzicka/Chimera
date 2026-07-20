/**
 * tools/practice-packaged-build.ts
 *
 * `practice:packaged-build` — a developer convenience that reproduces the `verify:scaffold`
 * pipeline (build → pack → scaffold via the REAL create-chimera-game CLI → override the app's
 * `@chimera-engine/*` deps onto the locally-packed tarballs → install → smoke → PACKAGED build)
 * but into a PERSISTENT sibling project directory (`../ChimeraTest`) the developer keeps and can
 * launch, instead of the gate's throwaway temp dir it deletes in `finally`.
 *
 * It simulates the published `npm create chimera-game` experience while sourcing every engine
 * package from THIS repo's freshly-built code: each `@chimera-engine/*` is packed to a tarball and
 * force-resolved via `file:<tarball>` (root `pnpm.overrides` + app dep rewrites), so a real
 * `pnpm install` never touches npm yet the DAG resolves exactly through the public `exports`.
 *
 * Steps (mirroring tools/verify-scaffold.ts, minus the slow Electron e2e boot-smoke):
 *   1. `pnpm build:packages`                          — emit every `@chimera-engine/*` dist/
 *   2. `pnpm pack` per engine package                 — one tarball per package → `<out>/tarballs`
 *   3. `create-chimera-game <name> --out <out>`       — the real CLI EMITS the standalone project
 *   4. layer tarball overrides onto the emitted root + rewrite the app's `@chimera-engine/*` deps
 *   5. `pnpm install`                                 — install tarballs + toolchain into `<out>`
 *   6. `pnpm --filter <app> test`                     — the generated app's unit smoke
 *   7. `pnpm --filter <app> build`                    — production tsc (standalone refs resolve)
 *   8. `pnpm --filter <app> verify:packaged-bundle`   — Invariant #27 gate (informational)
 *   9. `pnpm run package:<kebab>:mac-dir`             — the PACKAGED build → `apps/<kebab>/release`
 *
 * The two JSON transforms (`applyTarballOverrides`, `rewriteAppChimeraDeps`) are copied verbatim
 * from tools/verify-scaffold.ts so the emitted bytes match the gate exactly. The package list +
 * tarball parser are imported from the side-effect-free `verify-shared` to avoid drift.
 *
 * Invariant #2: lives in `tools/`; imports node builtins + the side-effect-free sibling
 * `verify-shared` only (never a `@chimera-engine/*` package).
 *
 * NOT a gate: it has no `--self-test` and is excluded from `test`/`lint` gating semantics; it is a
 * hand-run/`launch.json`-driven convenience. Every command runs through `pnpm` (globally on PATH),
 * so it needs no `node_modules/.bin` on PATH — safe to launch from a VS Code `node` launch config.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHIMERA_PACKAGES, parsePackTarballPath } from './verify-shared';

/** The fixed, clearly-disposable game name (overridable via the first CLI positional). */
const DEFAULT_GAME_NAME = 'Chimera Test';

/** Structural view of the standalone root manifest — only what the override transform touches. */
interface RootManifestLike {
    pnpm?: Record<string, unknown>;
    [key: string]: unknown;
}

// ── JSON transforms (verbatim from tools/verify-scaffold.ts) ─────────────────────

function buildPnpmOverrides(tarballs: Readonly<Record<string, string>>): Record<string, string> {
    const overrides: Record<string, string> = {};
    for (const [name, tgz] of Object.entries(tarballs)) overrides[name] = `file:${tgz}`;
    return overrides;
}

function applyTarballOverrides(
    manifest: RootManifestLike,
    tarballs: Readonly<Record<string, string>>,
): RootManifestLike {
    return {
        ...manifest,
        pnpm: { overrides: buildPnpmOverrides(tarballs), ...manifest.pnpm },
    };
}

function rewriteAppChimeraDeps(
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

// ── Process runner ───────────────────────────────────────────────────────────────

interface RunOptions {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly capture?: boolean;
    /** When true, a non-zero exit is logged but does not abort the run. */
    readonly allowFail?: boolean;
}

/**
 * Run a command, streaming (or capturing) its output. Aborts the whole practice run on the first
 * non-zero exit unless `allowFail` is set. Scrubs `ELECTRON_RUN_AS_NODE` so any Electron spawn runs
 * as Electron, not plain Node (matches the gate's own env scrub).
 */
function run(cmd: string, args: readonly string[], options: RunOptions = {}): string {
    const baseEnv: Record<string, string | undefined> = { ...process.env };
    delete baseEnv['ELECTRON_RUN_AS_NODE'];

    console.log(`\n$ (cwd=${options.cwd ?? process.cwd()}) ${cmd} ${args.join(' ')}`);
    const result = spawnSync(cmd, [...args], {
        cwd: options.cwd,
        env: { ...baseEnv, ...(options.env ?? {}) },
        encoding: 'utf8',
        shell: false,
        stdio: options.capture === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (options.capture === true && result.stderr) process.stderr.write(result.stderr);
    const status = result.status ?? 1;
    if (status !== 0 && options.allowFail !== true) {
        console.error(`\n✗ FAILED (exit ${status}): ${cmd} ${args.join(' ')}`);
        process.exit(status);
    }
    if (status !== 0) {
        console.warn(`\n⚠ non-fatal step exited ${status}: ${cmd} ${args.join(' ')}`);
    }
    return result.stdout ?? '';
}

// ── The pipeline ─────────────────────────────────────────────────────────────────

let step = 0;
function banner(message: string): void {
    console.log(`\n\n=========== [${(step += 1)}] ${message} ===========`);
}

function main(): void {
    const entryDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(entryDir, '..');
    const outRoot = path.resolve(repoRoot, '..', 'ChimeraTest');
    const gameName = process.argv[2] ?? DEFAULT_GAME_NAME;

    // Defense-in-depth: this tool wipes `outRoot` — never let it point anywhere but `../ChimeraTest`.
    if (
        path.basename(outRoot) !== 'ChimeraTest' ||
        path.dirname(outRoot) !== path.dirname(repoRoot)
    ) {
        throw new Error(`Refusing to wipe an unexpected output root: ${outRoot}`);
    }

    // 0. clean the target so re-runs start fresh.
    banner(`Clean target ${outRoot}`);
    rmSync(outRoot, { recursive: true, force: true });
    mkdirSync(outRoot, { recursive: true });

    // 1. build every @chimera-engine/* dist/.
    banner('build:packages (emit engine dist/)');
    run('pnpm', ['build:packages'], { cwd: repoRoot });

    // 2. pack each engine package into <out>/tarballs.
    banner('pnpm pack each engine package → tarballs/');
    const tarballsDir = path.join(outRoot, 'tarballs');
    mkdirSync(tarballsDir, { recursive: true });
    const tarballs: Record<string, string> = {};
    for (const pkg of CHIMERA_PACKAGES) {
        const stdout = run('pnpm', ['pack', '--pack-destination', tarballsDir], {
            cwd: path.join(repoRoot, pkg.dir),
            capture: true,
        });
        tarballs[pkg.name] = parsePackTarballPath(stdout, tarballsDir);
        console.log(`  packed ${pkg.name} → ${tarballs[pkg.name]}`);
    }

    // 3. scaffold via the REAL CLI in standalone --out mode (emits root + app on published ranges).
    banner('scaffold via create-chimera-game CLI (--out, standalone)');
    run('pnpm', ['exec', 'tsx', 'tools/create-chimera-game/index.ts', gameName, '--out', outRoot], {
        cwd: repoRoot,
    });

    // derive kebab + package name from the single scaffolded app dir.
    const appsDir = path.join(outRoot, 'apps');
    const kebab = readdirSync(appsDir).find((name) => !name.startsWith('.'));
    if (kebab === undefined) throw new Error('no scaffolded app under apps/');
    const appDir = path.join(appsDir, kebab);
    const appPkgPath = path.join(appDir, 'package.json');
    const pkgName = (JSON.parse(readFileSync(appPkgPath, 'utf8')) as { name: string }).name;
    console.log(`  scaffolded app: ${pkgName}  (apps/${kebab})`);

    // 4. layer tarball overrides onto the emitted root + rewrite the app's @chimera-engine/* deps
    //    onto the packed tarballs → the whole DAG resolves through THIS repo's built artifacts.
    banner('rewrite root + app deps onto local tarballs (simulate "installed from npm")');
    const rootPkgPath = path.join(outRoot, 'package.json');
    const emittedRoot = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as RootManifestLike;
    writeFileSync(
        rootPkgPath,
        `${JSON.stringify(applyTarballOverrides(emittedRoot, tarballs), null, 4)}\n`,
    );
    writeFileSync(appPkgPath, rewriteAppChimeraDeps(readFileSync(appPkgPath, 'utf8'), tarballs));

    // 5. install the standalone workspace (tarballs + toolchain).
    banner('pnpm install (fresh standalone workspace)');
    run('pnpm', ['install'], { cwd: outRoot });

    // 6. unit smoke — cheap; confirms the scaffold registered + booted its screens.
    banner('unit smoke: pnpm --filter <app> test');
    run('pnpm', ['--filter', pkgName, 'test'], { cwd: outRoot });

    // 7. production tsc build — proves the standalone refs resolve the engine from node_modules.
    banner('production build: pnpm --filter <app> build (tsc)');
    run('pnpm', ['--filter', pkgName, 'build'], { cwd: outRoot });

    // 8. Invariant #27 packaged-bundle gate (informational — a quirk here must not block the .app).
    banner('Invariant #27 gate: pnpm --filter <app> verify:packaged-bundle (informational)');
    run('pnpm', ['--filter', pkgName, 'verify:packaged-bundle'], { cwd: outRoot, allowFail: true });

    // 9. THE PACKAGED BUILD — the emitted root's mac-dir packaging script: packaged next build +
    //    packaged build:app + electron-builder --mac dir → apps/<kebab>/release/mac*/<Title>.app.
    banner(`PACKAGED BUILD: pnpm run package:${kebab}:mac-dir`);
    run('pnpm', ['run', `package:${kebab}:mac-dir`], { cwd: outRoot });

    const releaseDir = path.join(appDir, 'release');
    if (!existsSync(releaseDir)) {
        console.error(`\n✗ no release/ bundle produced at ${releaseDir}`);
        process.exit(1);
    }

    banner('DONE — packaged build produced');
    console.log(`project root : ${outRoot}`);
    console.log(`app          : ${pkgName}  (apps/${kebab})`);
    console.log(`release dir  : ${releaseDir}`);
    run('ls', ['-la', releaseDir], { allowFail: true });
    console.log(`\nLaunch it with:   (cd ${outRoot} && pnpm start)`);
    console.log('\n✅ SUCCESS');
}

// ── CLI entry ─────────────────────────────────────────────────────────────────────
// Runs only when executed directly (never on import), mirroring the sibling tools. Synchronous
// throughout (spawnSync + sync fs), so no async IIFE / top-level await is needed — tsx transforms
// `tools/*.ts` as CommonJS, where top-level await would crash.

if (process.env['VITEST'] === undefined) {
    const invokedPath = process.argv[1];
    if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
        main();
    }
}
