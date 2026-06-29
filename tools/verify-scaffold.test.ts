// tools/verify-scaffold.test.ts
//
// Unit tests for the `verify:scaffold` scaffold-and-smoke gate (issue #801, F65).
//
// Exercises the gate-owned pure wiring — buildPnpmOverrides, the applyTarballOverrides layer
// (which forces the published standalone manifest's @chimera-engine/* edges onto the packed tarballs),
// the app dependency rewrite (workspace:* -> file:<tarball>), and the verifyScaffold /
// verifyScaffoldSelfTest orchestration (step order, short-circuit on failure, finally cleanup) —
// with injected fakes, so no real pnpm, tsx, playwright, electron, or filesystem is touched.
//
// The standalone-root SYNTHESIZERS themselves (toolchain deps, root manifest, workspace yaml,
// unit-arm vitest config) are owned by create-chimera-game and unit-tested in standalone.test.ts.

import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import {
    PROBE_GAME,
    applyTarballOverrides,
    buildPnpmOverrides,
    rewriteAppChimeraDeps,
    verifyScaffold,
    verifyScaffoldSelfTest,
    type RunFn,
    type RunResult,
    type FsLike,
    type VerifyScaffoldDeps,
} from './verify-scaffold.js';
// The pure standalone-root synthesizers moved to create-chimera-game (their own unit tests live
// in standalone.test.ts); the gate's test builds a base manifest with one to exercise the
// gate-owned applyTarballOverrides layer.
import { buildStandaloneRootManifest } from './create-chimera-game/standalone.js';

// ── Fakes ─────────────────────────────────────────────────────────────────────

/** An in-memory FsLike backed by a Map; records rm() targets for cleanup asserts. */
function makeFakeFs(): { fs: FsLike; files: Map<string, string>; removed: string[] } {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const removed: string[] = [];
    let counter = 0;
    const fs: FsLike = {
        mkdtemp: (prefix) => {
            counter += 1;
            const dir = `${prefix}${counter}`;
            dirs.add(dir);
            return Promise.resolve(dir);
        },
        mkdir: (dir) => {
            dirs.add(dir);
            return Promise.resolve();
        },
        rm: (dir) => {
            removed.push(dir);
            return Promise.resolve();
        },
        writeFile: (file, data) => {
            files.set(file, data);
            return Promise.resolve();
        },
        readFile: (file) => {
            const data = files.get(file);
            if (data === undefined) return Promise.reject(new Error(`ENOENT: ${file}`));
            return Promise.resolve(data);
        },
        exists: (p) => Promise.resolve(files.has(p) || dirs.has(p)),
    };
    return { fs, files, removed };
}

interface RecordedCall {
    cmd: string;
    args: readonly string[];
    cwd?: string | undefined;
}

/**
 * A programmable RunFn. By default every command succeeds; `pnpm pack` echoes a
 * deterministic tarball path so the parser has something to read, and the scaffold
 * CLI run seeds the generated app's package.json + register.ts into the fake fs
 * (what the real CLI would write) so the rewrite/self-test steps have inputs.
 */
function makeFakeRun(
    files: Map<string, string>,
    tmpRoot: string,
    overrides: (cmd: string, args: readonly string[]) => RunResult | undefined = () => undefined,
): { run: RunFn; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const appDir = path.join(tmpRoot, 'apps', PROBE_GAME.kebab);
    const run: RunFn = (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts?.cwd });
        const override = overrides(cmd, args);
        if (override !== undefined) return override;
        if (args[0] === 'pack') {
            const destIdx = args.indexOf('--pack-destination');
            const dest = destIdx >= 0 ? args[destIdx + 1] : '.';
            const slug = path.basename(opts?.cwd ?? 'pkg');
            return {
                status: 0,
                stdout: `${path.join(dest ?? '.', `chimera-${slug}-0.9.0.tgz`)}\n`,
                stderr: '',
            };
        }
        // The scaffold CLI run: emulate what `create-chimera-game --out` writes in standalone mode
        // — the project ROOT (published-form toolchain manifest: no pnpm.overrides) AND the app
        // (with @chimera-engine/* on their published ^ranges). The gate then layers overrides on the root
        // and rewrites the app deps onto the tarballs.
        if (cmd === 'tsx' && args.some((a) => a.includes('create-chimera-game'))) {
            files.set(
                path.join(tmpRoot, 'package.json'),
                JSON.stringify({
                    name: PROBE_GAME.kebab,
                    version: '0.0.0',
                    private: true,
                    devDependencies: { next: '^15', vitest: '^3' },
                    scripts: { 'build:packages': 'node -e ""' },
                    pnpm: { onlyBuiltDependencies: ['electron', 'esbuild'] },
                }),
            );
            files.set(
                path.join(appDir, 'package.json'),
                JSON.stringify({
                    name: PROBE_GAME.pkg,
                    dependencies: {
                        '@chimera-engine/simulation': '^0.9.0',
                        '@chimera-engine/renderer': '^0.9.0',
                        '@chimera-engine/electron': '^0.9.0',
                    },
                }),
            );
            files.set(
                path.join(appDir, 'renderer', 'register.ts'),
                'registerRendererGame(contribution);\n',
            );
        }
        // The package step (electron-builder --dir) writes the unsigned bundle under <app>/release;
        // emulate that so the gate's post-package release-dir guard sees it.
        if (args.includes('exec') && args.includes('electron-builder')) {
            files.set(path.join(appDir, 'release'), 'bundle');
        }
        return { status: 0, stdout: '', stderr: '' };
    };
    return { run, calls };
}

// The tmp root the gate gets back from fs.mkdtemp — the fake returns `${prefix}${counter}`
// and the gate seeds the prefix below; a fresh fake (counter 1) per test makes this stable.
const TMP_ROOT = `${path.join(tmpdir(), 'chimera-verify-scaffold-')}1`;

const TARBALLS = {
    '@chimera-engine/simulation': '/tmp/t/chimera-simulation-0.9.0.tgz',
    '@chimera-engine/ai': '/tmp/t/chimera-ai-0.9.0.tgz',
    '@chimera-engine/networking': '/tmp/t/chimera-networking-0.9.0.tgz',
    '@chimera-engine/renderer': '/tmp/t/chimera-renderer-0.9.0.tgz',
    '@chimera-engine/electron': '/tmp/t/chimera-electron-0.9.0.tgz',
} as const;

function makeDeps(
    run: RunFn,
    fs: FsLike,
    extra: Partial<VerifyScaffoldDeps> = {},
): VerifyScaffoldDeps {
    return {
        run,
        fs,
        log: () => {},
        repoRoot: '/repo',
        ...extra,
    };
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

describe('buildPnpmOverrides', () => {
    it('maps every @chimera-engine/* package onto its file:<tarball> so packed internal edges resolve', () => {
        const overrides = buildPnpmOverrides(TARBALLS);
        expect(overrides['@chimera-engine/simulation']).toBe(
            `file:${TARBALLS['@chimera-engine/simulation']}`,
        );
        expect(overrides['@chimera-engine/renderer']).toBe(
            `file:${TARBALLS['@chimera-engine/renderer']}`,
        );
        expect(Object.keys(overrides)).toHaveLength(5);
    });
});

describe('applyTarballOverrides', () => {
    it('layers pnpm.overrides onto the published (override-free) manifest, forcing @chimera-engine/* onto tarballs', () => {
        // The CLI emits the published form: toolchain deps, no overrides (npm resolution).
        const published = buildStandaloneRootManifest({
            name: 'chimera-verify-scaffold-root',
            toolchainDeps: { next: '^15', electron: '^33' },
        });
        expect(published.pnpm.overrides).toBeUndefined();

        const resolved = applyTarballOverrides(published, TARBALLS);

        // Every @chimera-engine/* edge is forced onto its packed tarball for the gate's local verify.
        expect(resolved.pnpm.overrides?.['@chimera-engine/renderer']).toBe(
            `file:${TARBALLS['@chimera-engine/renderer']}`,
        );
        expect(Object.keys(resolved.pnpm.overrides ?? {})).toHaveLength(5);
        // The rest of the root is untouched: toolchain deps, no @chimera-engine/* leak, stubbed build.
        expect(resolved.devDependencies['next']).toBe('^15');
        expect(
            Object.keys(resolved.devDependencies).some((k) => k.startsWith('@chimera-engine/')),
        ).toBe(false);
        expect(resolved.pnpm.onlyBuiltDependencies).toEqual(['electron', 'esbuild']);
        expect(resolved.scripts['build:packages']).not.toContain('tsc');
        // overrides serialize first (historical key order).
        expect(Object.keys(resolved.pnpm)[0]).toBe('overrides');
    });
});

describe('rewriteAppChimeraDeps', () => {
    it('rewrites the app workspace:* @chimera-engine deps onto file:<tarball>, leaving others intact', () => {
        const raw = JSON.stringify({
            name: PROBE_GAME.pkg,
            dependencies: {
                '@chimera-engine/renderer': 'workspace:*',
                '@chimera-engine/simulation': 'workspace:*',
            },
        });
        const rewritten = JSON.parse(rewriteAppChimeraDeps(raw, TARBALLS));
        expect(rewritten.dependencies['@chimera-engine/renderer']).toBe(
            `file:${TARBALLS['@chimera-engine/renderer']}`,
        );
        expect(rewritten.dependencies['@chimera-engine/simulation']).toBe(
            `file:${TARBALLS['@chimera-engine/simulation']}`,
        );
        // No workspace:* spec survives (pnpm would reject it without a matching member).
        expect(JSON.stringify(rewritten)).not.toContain('workspace:*');
    });
});

// ── Orchestration ───────────────────────────────────────────────────────────────

describe('verifyScaffold', () => {
    it('runs build -> pack -> scaffold -> install -> unit -> e2e -> prod-build -> package and cleans up the tmp root', async () => {
        const { fs, files, removed } = makeFakeFs();
        const tmpRoot = TMP_ROOT;
        const { run, calls } = makeFakeRun(files, tmpRoot);

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(true);

        // Build first.
        expect(calls[0]).toMatchObject({ cmd: 'pnpm', args: ['build:packages'] });
        // Five packs.
        expect(calls.filter((c) => c.args[0] === 'pack')).toHaveLength(5);
        // The CLI scaffolds with --out into the tmp root.
        const cli = calls.find((c) => c.cmd === 'tsx');
        expect(cli?.args).toContain('--out');
        expect(cli?.args).toContain(tmpRoot);
        // Install, then the two smoke arms via --filter, from the standalone root.
        expect(calls.some((c) => c.args[0] === 'install' && c.cwd === tmpRoot)).toBe(true);
        const unit = calls.find((c) => c.args.includes('test') && !c.args.includes('test:e2e'));
        expect(unit?.args).toEqual(['--filter', PROBE_GAME.pkg, 'test']);
        const e2e = calls.find((c) => c.args.includes('test:e2e'));
        expect(e2e?.args).toEqual(['--filter', PROBE_GAME.pkg, 'test:e2e']);

        // Production build (#816): the app's `build` (tsc, proves the standalone refs rewrite) and
        // `build:app` (esbuild bundles), then the package step: a Next renderer export + an unsigned
        // electron-builder `--dir` bundle, all run from the standalone root by --filter.
        const prodBuild = calls.find(
            (c) => c.args.join(' ') === `--filter ${PROBE_GAME.pkg} build`,
        );
        expect(prodBuild?.cwd).toBe(tmpRoot);
        const buildApp = calls.find(
            (c) => c.args.join(' ') === `--filter ${PROBE_GAME.pkg} build:app`,
        );
        expect(buildApp?.cwd).toBe(tmpRoot);
        const nextBuild = calls.find((c) => c.args[0] === 'exec' && c.args[1] === 'next');
        expect(nextBuild?.args).toEqual([
            'exec',
            'next',
            'build',
            `apps/${PROBE_GAME.kebab}/renderer`,
        ]);
        const pkg = calls.find((c) => c.args.includes('--dir'));
        expect(pkg?.args).toEqual([
            '--filter',
            PROBE_GAME.pkg,
            'exec',
            'electron-builder',
            '--dir',
        ]);
        // The bundle lands under <app>/release.
        expect(files.has(path.join(tmpRoot, 'apps', PROBE_GAME.kebab, 'release'))).toBe(true);

        // Ordering: install < unit < e2e < prod-build (build) < build:app < next build < package.
        const idx = (pred: (c: RecordedCall) => boolean): number => calls.findIndex(pred);
        expect(idx((c) => c.args[0] === 'install')).toBeLessThan(idx((c) => c === unit));
        expect(idx((c) => c === unit)).toBeLessThan(idx((c) => c === e2e));
        expect(idx((c) => c === e2e)).toBeLessThan(idx((c) => c === prodBuild));
        expect(idx((c) => c === prodBuild)).toBeLessThan(idx((c) => c === buildApp));
        expect(idx((c) => c === buildApp)).toBeLessThan(idx((c) => c === nextBuild));
        expect(idx((c) => c === nextBuild)).toBeLessThan(idx((c) => c === pkg));

        // The gate layered tarball overrides onto the CLI-emitted root (it no longer synthesizes
        // the root — the CLI emits package.json/pnpm-workspace.yaml/vitest/tsconfig; that is the
        // CLI's contract, tested in create-chimera-game/index.test.ts).
        const rootPkg = JSON.parse(files.get(path.join(tmpRoot, 'package.json')) ?? '{}') as {
            pnpm?: { overrides?: Record<string, string> };
        };
        expect(rootPkg.pnpm?.overrides?.['@chimera-engine/renderer']).toContain('file:');
        // The app's @chimera-engine/* deps were rewritten onto the packed tarballs.
        const appPkg = files.get(path.join(tmpRoot, 'apps', PROBE_GAME.kebab, 'package.json'));
        expect(appPkg).toContain('file:');
        expect(appPkg).not.toContain('workspace:*');

        // Cleanup happened.
        expect(removed).toContain(tmpRoot);
    });

    it('short-circuits and reports the failed step (and still cleans up) when a step fails', async () => {
        const { fs, files, removed } = makeFakeFs();
        const tmpRoot = TMP_ROOT;
        const { run } = makeFakeRun(files, tmpRoot, (cmd, args) =>
            args.includes('test') && !args.includes('test:e2e')
                ? { status: 1, stdout: '', stderr: 'unit failed' }
                : undefined,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('unit');
        expect(removed).toContain(tmpRoot);
    });

    it('reports prod-build when the standalone tsc build fails (the refs rewrite regressed)', async () => {
        const { fs, files, removed } = makeFakeFs();
        const tmpRoot = TMP_ROOT;
        const { run } = makeFakeRun(files, tmpRoot, (cmd, args) =>
            args.join(' ') === `--filter ${PROBE_GAME.pkg} build`
                ? { status: 2, stdout: '', stderr: 'tsc: cannot find referenced project' }
                : undefined,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('prod-build');
        expect(removed).toContain(tmpRoot);
    });

    it('reports package when the electron-builder --dir step fails', async () => {
        const { fs, files, removed } = makeFakeFs();
        const tmpRoot = TMP_ROOT;
        const { run } = makeFakeRun(files, tmpRoot, (cmd, args) =>
            args.includes('--dir')
                ? { status: 1, stdout: '', stderr: 'electron-builder: icon not found' }
                : undefined,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('package');
        expect(removed).toContain(tmpRoot);
    });

    it('skips the e2e arm when skipE2e is set (cheap exercise of the gate)', async () => {
        const { fs, files } = makeFakeFs();
        const tmpRoot = TMP_ROOT;
        const { run, calls } = makeFakeRun(files, tmpRoot);

        const result = await verifyScaffold(makeDeps(run, fs), { skipE2e: true });

        expect(result.ok).toBe(true);
        expect(calls.some((c) => c.args.includes('test:e2e'))).toBe(false);
    });
});

describe('verifyScaffoldSelfTest', () => {
    it('PASSES (ok) when dropping the registration makes a smoke arm fail', async () => {
        const { fs, files } = makeFakeFs();
        const tmpRoot = TMP_ROOT;
        // The self-test breaks register.ts; the broken app must make the chosen arm exit non-zero.
        const { run } = makeFakeRun(files, tmpRoot, (cmd, args) => {
            // Simulate: after the registration is dropped, the unit arm fails.
            const appRegister = path.join(
                tmpRoot,
                'apps',
                PROBE_GAME.kebab,
                'renderer',
                'register.ts',
            );
            const broken =
                (files.get(appRegister) ?? '').includes('registerRendererGame') === false;
            if (broken && args.includes('test') && !args.includes('test:e2e')) {
                return { status: 1, stdout: '', stderr: 'no default game registered' };
            }
            return undefined;
        });

        const result = await verifyScaffoldSelfTest(makeDeps(run, fs));

        expect(result.ok).toBe(true);
    });

    it('FAILS (not ok) when the broken scaffold still passes — the gate is not biting', async () => {
        const { fs, files } = makeFakeFs();
        const tmpRoot = TMP_ROOT;
        // Every command succeeds even after the break → the gate did not detect the regression.
        const { run } = makeFakeRun(files, tmpRoot);

        const result = await verifyScaffoldSelfTest(makeDeps(run, fs));

        expect(result.ok).toBe(false);
    });
});
