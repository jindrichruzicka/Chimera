// tools/verify-scaffold.test.ts
//
// Unit tests for the `verify:scaffold` scaffold-and-smoke gate (issue #801, F65).
//
// Exercises the pure wiring — the standalone-root manifest (toolchain deps minus
// @chimera/*, pnpm.overrides onto the tarballs, a no-op build:packages), the app
// dependency rewrite (workspace:* -> file:<tarball>), the synthesized vitest config,
// and the verifyScaffold / verifyScaffoldSelfTest orchestration (step order,
// short-circuit on failure, finally cleanup) — with injected fakes, so no real
// pnpm, tsx, playwright, electron, or filesystem is touched.

import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import {
    PROBE_GAME,
    buildStandaloneToolchainDeps,
    buildPnpmOverrides,
    buildStandaloneRootManifest,
    rewriteAppChimeraDeps,
    buildStandaloneVitestConfig,
    verifyScaffold,
    verifyScaffoldSelfTest,
    type RunFn,
    type RunResult,
    type FsLike,
    type VerifyScaffoldDeps,
} from './verify-scaffold.js';

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
        // The scaffold CLI run: emulate the files create-chimera-game --out writes.
        if (cmd === 'tsx' && args.some((a) => a.includes('create-chimera-game'))) {
            files.set(
                path.join(appDir, 'package.json'),
                JSON.stringify({
                    name: PROBE_GAME.pkg,
                    dependencies: {
                        '@chimera/simulation': 'workspace:*',
                        '@chimera/renderer': 'workspace:*',
                        '@chimera/electron': 'workspace:*',
                    },
                }),
            );
            files.set(
                path.join(appDir, 'renderer', 'register.ts'),
                'registerRendererGame(contribution);\n',
            );
        }
        return { status: 0, stdout: '', stderr: '' };
    };
    return { run, calls };
}

// The tmp root the gate gets back from fs.mkdtemp — the fake returns `${prefix}${counter}`
// and the gate seeds the prefix below; a fresh fake (counter 1) per test makes this stable.
const TMP_ROOT = `${path.join(tmpdir(), 'chimera-verify-scaffold-')}1`;

const TARBALLS = {
    '@chimera/simulation': '/tmp/t/chimera-simulation-0.9.0.tgz',
    '@chimera/ai': '/tmp/t/chimera-ai-0.9.0.tgz',
    '@chimera/networking': '/tmp/t/chimera-networking-0.9.0.tgz',
    '@chimera/renderer': '/tmp/t/chimera-renderer-0.9.0.tgz',
    '@chimera/electron': '/tmp/t/chimera-electron-0.9.0.tgz',
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
        toolchainDeps: { next: '^15', react: '^19', vitest: '^3', electron: '^33' },
        rootTsconfig: '{ "compilerOptions": { "strict": true } }',
        ...extra,
    };
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

describe('buildStandaloneToolchainDeps', () => {
    it('merges root deps + devDeps and strips every @chimera/* workspace entry', () => {
        const deps = buildStandaloneToolchainDeps({
            dependencies: { three: '^0.184', '@chimera/renderer': 'workspace:*' },
            devDependencies: { vitest: '^3', '@chimera/tactics': 'workspace:*', next: '^15' },
        });
        expect(deps).toEqual({ three: '^0.184', vitest: '^3', next: '^15' });
        expect(Object.keys(deps).some((k) => k.startsWith('@chimera/'))).toBe(false);
    });
});

describe('buildPnpmOverrides', () => {
    it('maps every @chimera/* package onto its file:<tarball> so packed internal edges resolve', () => {
        const overrides = buildPnpmOverrides(TARBALLS);
        expect(overrides['@chimera/simulation']).toBe(`file:${TARBALLS['@chimera/simulation']}`);
        expect(overrides['@chimera/renderer']).toBe(`file:${TARBALLS['@chimera/renderer']}`);
        expect(Object.keys(overrides)).toHaveLength(5);
    });
});

describe('buildStandaloneRootManifest', () => {
    it('declares the toolchain, forces @chimera/* onto tarballs, and stubs build:packages', () => {
        const manifest = buildStandaloneRootManifest({ next: '^15', electron: '^33' }, TARBALLS);
        expect(manifest.private).toBe(true);
        expect(manifest.devDependencies['next']).toBe('^15');
        // No @chimera/* leaks into the declared deps (they arrive only via overrides + the app).
        expect(Object.keys(manifest.devDependencies).some((k) => k.startsWith('@chimera/'))).toBe(
            false,
        );
        expect(manifest.pnpm.overrides['@chimera/renderer']).toBe(
            `file:${TARBALLS['@chimera/renderer']}`,
        );
        // global-setup runs `pnpm build:packages` from the standalone root: it must be a no-op
        // (the packages arrive prebuilt as tarballs), never the engine's real build.
        expect(manifest.scripts['build:packages']).toBeDefined();
        expect(manifest.scripts['build:packages']).not.toContain('tsc');
    });
});

describe('rewriteAppChimeraDeps', () => {
    it('rewrites the app workspace:* @chimera deps onto file:<tarball>, leaving others intact', () => {
        const raw = JSON.stringify({
            name: PROBE_GAME.pkg,
            dependencies: {
                '@chimera/renderer': 'workspace:*',
                '@chimera/simulation': 'workspace:*',
            },
        });
        const rewritten = JSON.parse(rewriteAppChimeraDeps(raw, TARBALLS));
        expect(rewritten.dependencies['@chimera/renderer']).toBe(
            `file:${TARBALLS['@chimera/renderer']}`,
        );
        expect(rewritten.dependencies['@chimera/simulation']).toBe(
            `file:${TARBALLS['@chimera/simulation']}`,
        );
        // No workspace:* spec survives (pnpm would reject it without a matching member).
        expect(JSON.stringify(rewritten)).not.toContain('workspace:*');
    });
});

describe('buildStandaloneVitestConfig', () => {
    it('aliases chimera-game-registration to the app register and resolves @chimera via node_modules', () => {
        const config = buildStandaloneVitestConfig(PROBE_GAME.kebab);
        expect(config).toContain('chimera-game-registration');
        expect(config).toContain(`apps/${PROBE_GAME.kebab}/renderer/register.ts`);
        // The config must NOT pull @chimera/* onto source — that is the reach-through the gate forbids.
        expect(config).not.toContain('createPreferTypeScriptSourceResolver');
        expect(config).not.toContain('@chimera/renderer');
    });
});

// ── Orchestration ───────────────────────────────────────────────────────────────

describe('verifyScaffold', () => {
    it('runs build -> pack -> scaffold -> install -> unit -> e2e and cleans up the tmp root', async () => {
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
        // Ordering: install before unit before e2e.
        const idx = (pred: (c: RecordedCall) => boolean): number => calls.findIndex(pred);
        expect(idx((c) => c.args[0] === 'install')).toBeLessThan(idx((c) => c === unit));
        expect(idx((c) => c === unit)).toBeLessThan(idx((c) => c === e2e));

        // The standalone root + app rewrite were written.
        expect(files.has(path.join(tmpRoot, 'package.json'))).toBe(true);
        expect(files.has(path.join(tmpRoot, 'pnpm-workspace.yaml'))).toBe(true);
        expect(files.has(path.join(tmpRoot, 'vitest.config.mts'))).toBe(true);
        // The app tsconfigs `extends` the repo root from <tmp>/apps/<kebab>; the gate must provide it.
        expect(files.has(path.join(tmpRoot, 'tsconfig.json'))).toBe(true);
        const appPkg = files.get(path.join(tmpRoot, 'apps', PROBE_GAME.kebab, 'package.json'));
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
