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

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import {
    PROBE_BROKEN_REF_FILE,
    PROBE_FONT_FILE,
    PROBE_GAME,
    PROBE_ICONS_GENERATE_SCRIPT,
    PROBE_LINT_PLANTS,
    PROBE_UNKNOWN_TOKEN,
    PROBE_UNKNOWN_TOKEN_RULE,
    PROBE_NPMRC,
    PROBE_VALIDATE_ASSETS_SCRIPT,
    applyTarballOverrides,
    buildPnpmOverrides,
    rewriteAppChimeraDeps,
    verifyScaffold,
    verifyScaffoldSelfTest,
    type FontFixture,
    type RunFn,
    type RunResult,
    type VerifyScaffoldFs,
    type VerifyScaffoldDeps,
} from './verify-scaffold.js';
// The pure standalone-root synthesizers moved to create-chimera-game (their own unit tests live
// in standalone.test.ts); the gate's test builds a base manifest with one to exercise the
// gate-owned applyTarballOverrides layer.
import { buildStandaloneRootManifest } from './create-chimera-game/standalone.js';

// ── Fakes ─────────────────────────────────────────────────────────────────────

/**
 * What the fake fs prepends when resolving a path. macOS resolves a temp dir
 * to '/private' + the constructed path, and the two forms never compare equal.
 */
const REAL_PREFIX = '/private';

/** An in-memory FsLike backed by a Map; records rm() targets for cleanup asserts. */
function makeFakeFs(): { fs: VerifyScaffoldFs; files: Map<string, string>; removed: string[] } {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const removed: string[] = [];
    let counter = 0;
    const fs: VerifyScaffoldFs = {
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
        // Models macOS: a temp path is a symlink, and the resolved form is the
        // one a child process reports. An identity fake here would let a
        // comparison that skips resolution pass in the suite and fail on every
        // real run.
        realpath: (p) => Promise.resolve(p.startsWith(REAL_PREFIX) ? p : `${REAL_PREFIX}${p}`),
    };
    return { fs, files, removed };
}

interface RecordedCall {
    cmd: string;
    args: readonly string[];
    cwd?: string | undefined;
}

/**
 * Seed what a correct `pnpm install` leaves behind, minus the named bins. Lets a
 * failure test drop exactly one thing and leave every earlier arm passing, so
 * the reported step is the one under test rather than the first to notice.
 */
function seedInstallExcept(files: Map<string, string>, omittedBins: readonly string[]): void {
    for (const bin of [
        'chimera-fetch-fonts',
        'chimera-validate-assets',
        'chimera-generate-icons',
    ]) {
        if (omittedBins.includes(bin)) continue;
        files.set(path.join(APP_DIR, 'node_modules', '.bin', bin), '#!node');
    }
    files.set(
        path.join(ELECTRON_REAL_DIR, 'package.json'),
        JSON.stringify({
            name: '@chimera-engine/electron',
            dependencies: { typescript: '^5.7.2' },
            peerDependencies: { sharp: '^0.35.2', png2icons: '^2.0.1' },
            peerDependenciesMeta: { sharp: { optional: true }, png2icons: { optional: true } },
        }),
    );
}

/**
 * ESLint's `-f json` output for `findings`, under pnpm's script banner.
 *
 * The banner is not decoration: pnpm prints it to the same stream, so a reader
 * that fed the whole capture to `JSON.parse` would throw on every real run.
 */
function eslintJsonReport(
    appDir: string,
    findings: readonly { rel: string; ruleId: string }[],
): string {
    const byFile = new Map<string, { ruleId: string }[]>();
    for (const finding of findings) {
        // RESOLVED paths, the way ESLint prints them — the arm builds its lookup
        // keys from the constructed temp path, so a comparison that does not
        // resolve first misses every finding.
        const key = path.join(`${REAL_PREFIX}${appDir}`, finding.rel);
        byFile.set(key, [...(byFile.get(key) ?? []), { ruleId: finding.ruleId }]);
    }
    const results = [...byFile].map(([filePath, messages]) => ({
        filePath,
        messages: messages.map((message) => ({ ...message, severity: 2, message: 'x' })),
    }));
    return `\n> probe@0.0.0 lint ${appDir}\n> eslint . "-f" "json"\n\n${JSON.stringify(results)}\n`;
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
): { run: RunFn; calls: RecordedCall[]; installNpmrc: () => string | undefined } {
    const calls: RecordedCall[] = [];
    /** The `.npmrc` as it stood when `pnpm install` ran — undefined if absent. */
    let installNpmrc: string | undefined;
    const appDir = path.join(tmpRoot, 'apps', PROBE_GAME.kebab);
    const electronRealDir = ELECTRON_REAL_DIR;
    const run: RunFn = (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts?.cwd });
        const override = overrides(cmd, args);
        if (override !== undefined) return override;
        // `pnpm lint` answers from the fake tree by file presence, and for the
        // token plant by its content, so the arm's clean and planted halves are
        // told apart by state rather than by call order. It never reads a plant's `source`: that the sources really do
        // violate their rules is proven only by `verify:scaffold`.
        // The subpath-resolution probe. Answers from the same fake tree the
        // install seeded, so deleting the entry reds the arm exactly as a
        // missing export would.
        if (cmd === 'node' && String(args[1] ?? '').includes('@chimera-engine/electron/eslint')) {
            const present = files.has(
                path.join(
                    appDir,
                    'node_modules/@chimera-engine/electron/dist/dev-tools/eslint/index.js',
                ),
            );
            return present
                ? { status: 0, stdout: '', stderr: '' }
                : {
                      status: 1,
                      stdout: '',
                      stderr: "Cannot find module '@chimera-engine/electron/eslint'",
                  };
        }
        if (args[0] === 'lint') {
            const findings: { rel: string; ruleId: string }[] = PROBE_LINT_PLANTS.filter((plant) =>
                files.has(path.join(appDir, plant.rel)),
            ).map((plant) => ({ rel: plant.rel, ruleId: plant.ruleId }));
            if (
                (files.get(path.join(appDir, 'styles', 'tokens-override.css')) ?? '').includes(
                    PROBE_UNKNOWN_TOKEN,
                )
            ) {
                findings.push({
                    rel: 'styles/tokens-override.css',
                    ruleId: PROBE_UNKNOWN_TOKEN_RULE,
                });
            }
            // The format the arm asked for. `-f json` reaches ESLint through the
            // root forward, so a fake that answered stylish either way would let
            // a dropped flag pass here and fail only against a real scaffold.
            return {
                status: findings.length > 0 ? 1 : 0,
                stdout: args.includes('json')
                    ? eslintJsonReport(appDir, findings)
                    : findings
                          .map(
                              (finding) =>
                                  `${path.join(appDir, finding.rel)}\n  1:1  error  x  ${finding.ruleId}`,
                          )
                          .join('\n'),
                stderr: '',
            };
        }
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
                    pnpm: {
                        onlyBuiltDependencies: ['electron', 'esbuild'],
                        ignoredBuiltDependencies: ['sharp'],
                    },
                }),
            );
            files.set(
                path.join(appDir, 'package.json'),
                JSON.stringify({
                    name: PROBE_GAME.pkg,
                    scripts: {
                        'fetch:fonts': `chimera-fetch-fonts --game ${PROBE_GAME.kebab} --out-dir assets/fonts`,
                        'validate:assets': PROBE_VALIDATE_ASSETS_SCRIPT,
                        'icons:generate': PROBE_ICONS_GENERATE_SCRIPT,
                    },
                    dependencies: {
                        '@chimera-engine/simulation': '^0.9.0',
                        '@chimera-engine/renderer': '^0.9.0',
                        '@chimera-engine/electron': '^0.9.0',
                    },
                }),
            );
            // The lint guardrails the template ships (§4.32): the token stub the
            // rule matches by name, and the flat config the app's own script runs.
            files.set(
                path.join(appDir, 'styles', 'tokens-override.css'),
                ':root {\n    --ch-color-accent: #4f46e5;\n}\n',
            );
            files.set(
                path.join(appDir, 'eslint.config.mjs'),
                'export default [...standaloneLintConfig()];\n',
            );
            files.set(
                path.join(appDir, 'renderer', 'register.ts'),
                'registerRendererGame(contribution);\n',
            );
        }
        // Install links the published bins into the app's own node_modules/.bin
        // (how the bare `chimera-fetch-fonts` in the app script resolves).
        if (args[0] === 'install') {
            // The hoist pin has to be on disk BEFORE this runs — an `.npmrc`
            // written afterwards has no effect on the tree that was installed.
            // Read here, at the moment the real pnpm would read it, so moving
            // the write later cannot pass; an end-of-run assertion on the file
            // could not tell the two apart.
            installNpmrc = files.get(path.join(tmpRoot, '.npmrc'));
            files.set(path.join(appDir, 'node_modules', '.bin', 'chimera-fetch-fonts'), '#!node');
            files.set(
                path.join(appDir, 'node_modules', '.bin', 'chimera-validate-assets'),
                '#!node',
            );
            files.set(
                path.join(appDir, 'node_modules', '.bin', 'chimera-generate-icons'),
                '#!node',
            );
            // The published `./eslint` subpath. Not a bin — the lint arm resolves
            // the module the app's flat config imports.
            files.set(
                path.join(
                    appDir,
                    'node_modules/@chimera-engine/electron/dist/dev-tools/eslint/index.js',
                ),
                'export const chimeraPlugin = {};',
            );
            // The installed manifest the arms read declarations off — what
            // `npm install @chimera-engine/electron` consults. The codecs are
            // OPTIONAL peers and deliberately absent from `dependencies`; the
            // fake never writes them into any node_modules, which is what a
            // correct install looks like.
            files.set(
                path.join(electronRealDir, 'package.json'),
                JSON.stringify({
                    name: '@chimera-engine/electron',
                    dependencies: { typescript: '^5.7.2' },
                    peerDependencies: { sharp: '^0.35.2', png2icons: '^2.0.1' },
                    peerDependenciesMeta: {
                        sharp: { optional: true },
                        png2icons: { optional: true },
                    },
                }),
            );
        }
        // A codec-absent `icons:generate` run: the bin resolves and RUNS, and
        // fails with the actionable message. This is the shape a real adopter
        // hits before opting into the codecs — and the shape a no-opping entry
        // guard could not produce, since that exits 0 saying nothing.
        if (args.includes('icons:generate')) {
            return {
                status: 1,
                stdout: '',
                stderr:
                    '[generate-icons] generate-icons: sharp + png2icons are required to generate ' +
                    'icons and are optional peer dependencies. Install them as devDependencies: ' +
                    'pnpm add -D sharp png2icons\n',
            };
        }
        // The validate-assets arm runs the SAME command twice and requires
        // different answers: clean first, then non-zero once a broken ref sits
        // under the app's data/. The fake reads the planted file rather than
        // counting calls, so a gate that forgot to plant it cannot pass.
        if (args.includes('validate:assets')) {
            const planted = files.has(path.join(appDir, 'data', PROBE_BROKEN_REF_FILE));
            return planted
                ? {
                      status: 1,
                      stdout: '',
                      stderr: `[validate-assets] Missing asset files:\n- ${PROBE_GAME.kebab}/textures/__missing__.png\n`,
                  }
                : {
                      status: 0,
                      stdout: '[validate-assets] Checked 3 asset refs; all files exist.\n',
                      stderr: '',
                  };
        }
        // The arm realpaths the installed electron package before reading its
        // manifest — pnpm installs it as a symlink, and the closure link only
        // exists on the far side.
        if (cmd === 'node' && args[0] === '-e' && args[1]?.includes('realpathSync') === true) {
            return { status: 0, stdout: electronRealDir, stderr: '' };
        }
        // A successful chimera-fetch-fonts run lands the fixture-served woff2
        // under the app's own assets/fonts (what the real bin writes).
        if (args.includes('fetch:fonts')) {
            files.set(path.join(appDir, 'assets', 'fonts', PROBE_FONT_FILE), 'wOF2');
        }
        // The package step (electron-builder --dir) writes the unsigned bundle under <app>/release;
        // emulate that so the gate's post-package release-dir guard sees it.
        if (args.includes('exec') && args.includes('electron-builder')) {
            files.set(path.join(appDir, 'release'), 'bundle');
        }
        // The dev-harness dry run prints the spawn-plan JSON after pnpm's script banner —
        // the gate must extract + validate the JSON despite the banner noise.
        if (args.includes('dev:mp')) {
            const report = {
                appDir,
                entry: path.join(appDir, 'dist', 'electron', 'main.js'),
                players: 2,
                instances: [
                    { label: 'p1', args: ['--dev-auto-host'], userDataDir: 'p1' },
                    { label: 'p2', args: ['--dev-auto-join=<announce>'], userDataDir: 'p2' },
                ],
            };
            return {
                status: 0,
                stdout: `> ${PROBE_GAME.pkg}@0.1.0 dev:mp\n${JSON.stringify(report, null, 2)}\n`,
                stderr: '',
            };
        }
        return { status: 0, stdout: '', stderr: '' };
    };
    return { run, calls, installNpmrc: () => installNpmrc };
}

// The tmp root the gate gets back from fs.mkdtemp — the fake returns `${prefix}${counter}`
// and the gate seeds the prefix below; a fresh fake (counter 1) per test makes this stable.
const TMP_ROOT = `${path.join(tmpdir(), 'chimera-verify-scaffold-')}1`;
const APP_DIR = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab);
/** Where pnpm's store materialises the installed engine package (see makeFakeRun). */
const ELECTRON_REAL_DIR = path.join(
    TMP_ROOT,
    'node_modules',
    '.pnpm',
    '@chimera-engine+electron@1.0.0',
    'node_modules',
    '@chimera-engine',
    'electron',
);

const TARBALLS = {
    '@chimera-engine/simulation': '/tmp/t/chimera-simulation-0.9.0.tgz',
    '@chimera-engine/ai': '/tmp/t/chimera-ai-0.9.0.tgz',
    '@chimera-engine/networking': '/tmp/t/chimera-networking-0.9.0.tgz',
    '@chimera-engine/renderer': '/tmp/t/chimera-renderer-0.9.0.tgz',
    '@chimera-engine/electron': '/tmp/t/chimera-electron-0.9.0.tgz',
} as const;

/** A fake localhost font fixture recording its start/close lifecycle. */
function makeFakeFontFixture(port = 41234): {
    start: () => Promise<FontFixture>;
    state: { started: number; closed: number };
} {
    const state = { started: 0, closed: 0 };
    return {
        start: () => {
            state.started += 1;
            return Promise.resolve({
                port,
                close: () => {
                    state.closed += 1;
                },
            });
        },
        state,
    };
}

function makeDeps(
    run: RunFn,
    fs: VerifyScaffoldFs,
    extra: Partial<VerifyScaffoldDeps> = {},
): VerifyScaffoldDeps {
    return {
        run,
        fs,
        log: () => {},
        repoRoot: '/repo',
        startFontFixture: makeFakeFontFixture().start,
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
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20.0.0' },
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
        expect(resolved.pnpm.ignoredBuiltDependencies).toEqual(['sharp']);
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

    it('rewrites @chimera-engine deps declared in devDependencies too (#817 template shape)', () => {
        // The blank template carries the engine packages in devDependencies (build-time-inlined,
        // kept out of electron-builder's prod tree). The gate must still resolve them onto tarballs
        // there, or the surviving workspace:* makes pnpm install reject the scaffolded app.
        const raw = JSON.stringify({
            name: PROBE_GAME.pkg,
            devDependencies: {
                '@chimera-engine/renderer': 'workspace:*',
                '@chimera-engine/simulation': 'workspace:*',
                electron: '^33.2.0',
            },
        });
        const rewritten = JSON.parse(rewriteAppChimeraDeps(raw, TARBALLS));
        expect(rewritten.devDependencies['@chimera-engine/renderer']).toBe(
            `file:${TARBALLS['@chimera-engine/renderer']}`,
        );
        expect(rewritten.devDependencies['@chimera-engine/simulation']).toBe(
            `file:${TARBALLS['@chimera-engine/simulation']}`,
        );
        expect(rewritten.devDependencies.electron).toBe('^33.2.0');
        expect(JSON.stringify(rewritten)).not.toContain('workspace:*');
    });
});

/**
 * An override for the validate-assets arm's CLEAN-RUN cases: answers the clean
 * run with `cleanResult` and the PLANTED run the way a correct bin would —
 * non-zero, naming the missing ref.
 *
 * The distinction is load-bearing. The arm runs the same command twice, and an
 * override that answered both identically would let the PLANTED guard throw
 * first with the same `failedStep`, so the test would pass green while the
 * clean-run assertion it names was never reached.
 */
function cleanRunOverride(
    files: Map<string, string>,
    cleanResult: RunResult,
): (cmd: string, args: readonly string[]) => RunResult | undefined {
    const brokenRef = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab, 'data', PROBE_BROKEN_REF_FILE);
    return (_cmd, args) => {
        if (!args.includes('validate:assets')) return undefined;
        if (files.has(brokenRef)) {
            return {
                status: 1,
                stdout: '',
                stderr: `[validate-assets] Missing asset files:\n- ${PROBE_GAME.kebab}/textures/__missing__.png\n`,
            };
        }
        return cleanResult;
    };
}

/**
 * The mirror of {@link cleanRunOverride}: answers the CLEAN run the way a
 * correct bin would and the PLANTED run with `plantedResult`. Without it a
 * malformed planted answer trips the clean run's own guards first, and the
 * planted assertion under test is never reached.
 */
function plantedRunOverride(
    files: Map<string, string>,
    plantedResult: RunResult,
): (cmd: string, args: readonly string[]) => RunResult | undefined {
    const brokenRef = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab, 'data', PROBE_BROKEN_REF_FILE);
    return (_cmd, args) => {
        if (!args.includes('validate:assets')) return undefined;
        return files.has(brokenRef)
            ? plantedResult
            : {
                  status: 0,
                  stdout: '[validate-assets] Checked 3 asset refs; all files exist.\n',
                  stderr: '',
              };
    };
}

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

        // The generated app's own Invariant #27 gate (#902): the engine-exported
        // packaged-bundle guard, run through the app's `verify:packaged-bundle`
        // script so a broken TEMPLATE gate fails the engine's own CI rather than
        // a downstream adopter's packaging run.
        const packagedGate = calls.find((c) => c.args.includes('verify:packaged-bundle'));
        expect(packagedGate?.args).toEqual(['--filter', PROBE_GAME.pkg, 'verify:packaged-bundle']);
        expect(packagedGate?.cwd).toBe(tmpRoot);

        // The dev-harness dry run (§4.32) exercises the packaged chimera-dev-mp bin against
        // the built app — after build:app (the entry exists), before the package arm.
        const devMp = calls.find((c) => c.args.includes('dev:mp'));
        expect(devMp?.args).toEqual(['--filter', PROBE_GAME.pkg, 'dev:mp', '2', '--dry-run']);
        expect(devMp?.cwd).toBe(tmpRoot);

        // Ordering: install < unit < e2e < prod-build (build) < build:app <
        // packaged-bundle gate < dev:mp dry-run < next build < package. The gate
        // sits after build:app (the app must be buildable) and before the arms
        // that read `dist/`: it rebuilds dist twice and leaves the DEV bundle
        // restored, which is exactly the shape the dry run + package arms expect.
        const idx = (pred: (c: RecordedCall) => boolean): number => calls.findIndex(pred);
        expect(idx((c) => c.args[0] === 'install')).toBeLessThan(idx((c) => c === unit));
        expect(idx((c) => c === unit)).toBeLessThan(idx((c) => c === e2e));
        expect(idx((c) => c === e2e)).toBeLessThan(idx((c) => c === prodBuild));
        expect(idx((c) => c === prodBuild)).toBeLessThan(idx((c) => c === buildApp));
        expect(idx((c) => c === buildApp)).toBeLessThan(idx((c) => c === packagedGate));
        expect(idx((c) => c === packagedGate)).toBeLessThan(idx((c) => c === devMp));
        expect(idx((c) => c === devMp)).toBeLessThan(idx((c) => c === nextBuild));
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

    it("reports packaged-bundle when the generated app's Invariant #27 gate fails", async () => {
        // The gate's own output explains WHAT failed (marker, allowlist,
        // negative control); the scaffold pipeline only needs to attribute the
        // step so a template regression is not misread as a packaging failure.
        const { fs, files, removed } = makeFakeFs();
        const tmpRoot = TMP_ROOT;
        const { run } = makeFakeRun(files, tmpRoot, (_cmd, args) =>
            args.includes('verify:packaged-bundle')
                ? { status: 1, stdout: '', stderr: 'packaged main still carries the debug layer' }
                : undefined,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('packaged-bundle');
        expect(removed).toContain(tmpRoot);
    });

    it('reports dev-harness when the chimera-dev-mp dry run fails', async () => {
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) =>
            args.includes('dev:mp')
                ? { status: 1, stdout: '', stderr: 'bin not found' }
                : undefined,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('dev-harness');
    });

    it('reports dev-harness when the dry run exits 0 but prints no parseable spawn plan', async () => {
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) =>
            args.includes('dev:mp')
                ? { status: 0, stdout: 'not a spawn plan\n', stderr: '' }
                : undefined,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('dev-harness');
    });

    it('runs the fonts arm: bin resolution + localhost-fixture fetch landing the woff2 in the app assets (Invariant #97)', async () => {
        const { fs, files } = makeFakeFs();
        const { run, calls } = makeFakeRun(files, TMP_ROOT);
        const fixture = makeFakeFontFixture(45678);
        const appDir = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab);

        const result = await verifyScaffold(makeDeps(run, fs, { startFontFixture: fixture.start }));

        expect(result.ok).toBe(true);
        // The real fetch is driven the way the docs tell a developer to drive it:
        // `pnpm fetch:fonts --url …` from the PROJECT ROOT. That routes through the
        // root forward, the shipped app script, and pnpm's trailing-arg append
        // before reaching the bin — so a script that dies in `sh`, a missing root
        // forward, or a swallowed `--url` all fail here. Invoking the bin with a
        // hand-built argv (what this arm used to do) proved none of that. The URL
        // points at the localhost fixture, never live Google.
        const fetch = calls.find((c) => c.args.includes('fetch:fonts'));
        expect(fetch?.cmd).toBe('pnpm');
        expect(fetch?.args).toEqual(['run', 'fetch:fonts', '--url', 'http://127.0.0.1:45678/css']);
        // cwd is the project ROOT, not the app dir: the root script is the entry
        // point, and pnpm re-enters the app dir itself for the delegated script
        // (which is what keeps `--out-dir assets/fonts` app-relative below).
        expect(fetch?.cwd).toBe(TMP_ROOT);
        // Fixture lifecycle: started once, closed once.
        expect(fixture.state).toEqual({ started: 1, closed: 1 });
        // The woff2 landed in the app's own assets/fonts.
        expect(files.has(path.join(appDir, 'assets', 'fonts', PROBE_FONT_FILE))).toBe(true);
        // Ordering: after the dev-harness dry run, before the package arm.
        const idx = (pred: (c: { args: readonly string[] }) => boolean): number =>
            calls.findIndex(pred);
        expect(idx((c) => c.args.includes('dev:mp'))).toBeLessThan(idx((c) => c === fetch));
        expect(idx((c) => c === fetch)).toBeLessThan(idx((c) => c.args.includes('--dir')));
    });

    it('reports fonts when the fetch:fonts script does not name the chimera-fetch-fonts bin', async () => {
        const { fs, files } = makeFakeFs();
        const appPkgPath = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab, 'package.json');
        // Fails ONLY the bin-name conjunct: the --out-dir shape is intact.
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
            if (args[0] === 'install') {
                files.set(
                    appPkgPath,
                    JSON.stringify({
                        name: PROBE_GAME.pkg,
                        scripts: { 'fetch:fonts': 'some-other-bin --out-dir assets/fonts' },
                    }),
                );
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('fonts');
    });

    it('reports fonts when --out-dir carries the wrong value, not just when it is absent', async () => {
        const { fs, files } = makeFakeFs();
        const appPkgPath = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab, 'package.json');
        // `--out-dir fonts` would re-land files in the wrong place for the
        // scaffolded cwd — the guard must pin the exact value.
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
            if (args[0] === 'install') {
                files.set(
                    appPkgPath,
                    JSON.stringify({
                        name: PROBE_GAME.pkg,
                        scripts: {
                            'fetch:fonts': 'chimera-fetch-fonts --game x --url y --out-dir fonts',
                        },
                    }),
                );
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('fonts');
    });

    it('reports fonts (never a silent pass) when the fixture server fails to start', async () => {
        const { fs, files } = makeFakeFs();
        const { run, calls } = makeFakeRun(files, TMP_ROOT);

        const result = await verifyScaffold(
            makeDeps(run, fs, {
                startFontFixture: () => Promise.reject(new Error('boom')),
            }),
        );

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('fonts');
        // The fetch never ran — the arm failed before it, not around it.
        expect(calls.some((c) => c.args.includes('fetch:fonts'))).toBe(false);
    });

    it('reports fonts when the scaffolded fetch:fonts script lost its --out-dir (path-doubling regression)', async () => {
        const { fs, files } = makeFakeFs();
        const appPkgPath = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab, 'package.json');
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
            if (args[0] === 'install') {
                // Rewrite the scaffolded manifest as if the template dropped the flag.
                files.set(
                    appPkgPath,
                    JSON.stringify({
                        name: PROBE_GAME.pkg,
                        scripts: { 'fetch:fonts': 'chimera-fetch-fonts --game x --url y' },
                    }),
                );
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('fonts');
    });

    // The regression that shipped: a script documenting its argument inline as
    // `--url <google-css-url>`. Every other check in this arm passed it — the bin
    // is named, `--out-dir assets/fonts` is present, the shim is linked — because
    // the defect is not in the script's CONTENT but in what `sh` does with it:
    // `<google-css-url>` is a redirection, so sh tries to open that file, fails,
    // and the bin is never looked up. The fixture below is otherwise perfect, so
    // only the redirection check can fail it.
    it('reports fonts when the fetch:fonts script carries a shell redirection (< placeholder)', async () => {
        const { fs, files } = makeFakeFs();
        const appPkgPath = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab, 'package.json');
        const { run, calls } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
            if (args[0] === 'install') {
                files.set(
                    appPkgPath,
                    JSON.stringify({
                        name: PROBE_GAME.pkg,
                        scripts: {
                            'fetch:fonts': `chimera-fetch-fonts --game ${PROBE_GAME.kebab} --url <google-css-url> --out-dir assets/fonts`,
                        },
                    }),
                );
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('fonts');
        // Refused BEFORE running anything: the arm names the cause rather than
        // letting step (c) surface it as an opaque non-zero exit from sh.
        expect(calls.some((c) => c.args.includes('fetch:fonts'))).toBe(false);
    });

    it('reports fonts when the bin is not linked under the app node_modules/.bin', async () => {
        const { fs, files } = makeFakeFs();
        // Bypass the default install seeding so no .bin shim exists.
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) =>
            args[0] === 'install' ? { status: 0, stdout: '', stderr: '' } : undefined,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('fonts');
    });

    it('reports fonts (and still closes the fixture) when the fetch run fails', async () => {
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) =>
            args.includes('fetch:fonts')
                ? { status: 1, stdout: '', stderr: 'fetch failed' }
                : undefined,
        );
        const fixture = makeFakeFontFixture();

        const result = await verifyScaffold(makeDeps(run, fs, { startFontFixture: fixture.start }));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('fonts');
        expect(fixture.state.closed).toBe(1);
    });

    it('reports fonts when the fetch succeeds but lands no woff2 under the app assets', async () => {
        const { fs, files } = makeFakeFs();
        // Success without the default woff2 seeding: the bin "ran" but wrote nowhere.
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) =>
            args.includes('fetch:fonts') ? { status: 0, stdout: '', stderr: '' } : undefined,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('fonts');
    });

    it('reports fonts when the download also lands under the doubled apps/<kebab>/apps/… path', async () => {
        const { fs, files } = makeFakeFs();
        const appDir = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab);
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
            if (args.includes('fetch:fonts')) {
                files.set(path.join(appDir, 'assets', 'fonts', PROBE_FONT_FILE), 'wOF2');
                files.set(
                    path.join(appDir, 'apps', PROBE_GAME.kebab, 'assets', 'fonts', PROBE_FONT_FILE),
                    'wOF2',
                );
                return { status: 0, stdout: '', stderr: '' };
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('fonts');
    });

    // ── validate-assets arm (§4.10, Invariants #22/#52) ───────────────────────

    it('runs the validate-assets arm: bin resolution, a clean pass, and a planted broken ref that FAILS', async () => {
        const { fs, files, removed } = makeFakeFs();
        const appDir = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab);
        const { run, calls } = makeFakeRun(files, TMP_ROOT);

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(true);
        // TWO runs of the same script — the second is the whole point. One run
        // proves only that the bin exits 0, which a bin that scanned nothing
        // also does.
        const validateRuns = calls.filter((c) => c.args.includes('validate:assets'));
        expect(validateRuns).toHaveLength(2);
        // Run from the PROJECT ROOT via --filter, which is what puts the
        // script's cwd at the app package and makes its `../..` the root.
        for (const call of validateRuns) {
            expect(call.cwd).toBe(TMP_ROOT);
            expect(call.args).toEqual(['--filter', PROBE_GAME.pkg, 'validate:assets']);
        }
        // The probe file is planted under the app's own data/ — the only place
        // content-JSON discovery reads — and names an asset that is not there.
        const brokenRef = path.join(appDir, 'data', PROBE_BROKEN_REF_FILE);
        expect(files.has(brokenRef)).toBe(true);
        expect(JSON.parse(files.get(brokenRef) ?? '{}')).toEqual({
            portrait: `${PROBE_GAME.kebab}/textures/__missing__.png`,
        });
        // ...and is removed again. The fake `rm` records rather than deletes,
        // so this is the only way to see the cleanup happened at all; without
        // it the arm could leave the probe behind and nothing would notice.
        expect(removed).toContain(brokenRef);
    });

    it('reports validate-assets when the app script is not the exact ../.. invocation', async () => {
        const { fs, files } = makeFakeFs();
        const appDir = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab);
        const { run } = makeFakeRun(files, TMP_ROOT, (cmd, args) => {
            // Rewrite the script AFTER the scaffold seeds it: one segment too
            // deep resolves above the project, which is the mistake the
            // whole-string check exists to catch.
            if (args[0] === 'install') {
                const pkg = JSON.parse(files.get(path.join(appDir, 'package.json')) ?? '{}') as {
                    scripts: Record<string, string>;
                };
                pkg.scripts['validate:assets'] = 'chimera-validate-assets ../../..';
                files.set(path.join(appDir, 'package.json'), JSON.stringify(pkg));
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('validate-assets');
    });

    it('reports validate-assets when the bin is not linked under the app node_modules/.bin', async () => {
        const { fs, files } = makeFakeFs();
        const appDir = path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab);
        const { run } = makeFakeRun(files, TMP_ROOT, (cmd, args) => {
            if (args[0] === 'install') {
                // Seed the fonts bin only, so the fonts arm still passes and
                // this arm is the one that fails.
                files.set(
                    path.join(appDir, 'node_modules', '.bin', 'chimera-fetch-fonts'),
                    '#!node',
                );
                return { status: 0, stdout: '', stderr: '' };
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('validate-assets');
    });

    it('reports validate-assets when the clean run exits 0 but reports no checked-ref count', async () => {
        // The vacuity case that an exit-code-only assertion cannot see: a bin
        // that refuses, crashes, or no-ops still exits 0 in this fake, but it
        // never prints the count line a real scan produces.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            cleanRunOverride(files, { status: 0, stdout: '', stderr: '' }),
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('validate-assets');
    });

    it('reports validate-assets when the planted broken ref STILL exits 0 (the check is vacuous)', async () => {
        // The arm's reason for existing. The planted run here NAMES the ref, so
        // the exit-code guard is the only thing that can catch it — a run that
        // reports the problem and exits 0 is exactly the broken-plumbing case,
        // and it must not be reachable through the ref-name guard instead.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedRunOverride(files, {
                status: 0,
                stdout: `[validate-assets] Missing asset files:\n- ${PROBE_GAME.kebab}/textures/__missing__.png\n`,
                stderr: '',
            }),
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('validate-assets');
    });

    it('plants a violation of every rule the preset curates, and of nothing else', async () => {
        // The inventory otherwise grades itself: the fake `pnpm lint` answers
        // from PROBE_LINT_PLANTS and every assertion reads the same constant, so
        // dropping an entry removes both the plant and its check. The authority
        // is the curated manifest, read as TEXT rather than imported — `tools/`
        // does not take a dependency on the engine's source tree.
        const manifest = await readFile(
            path.join(import.meta.dirname, '../electron/dev-tools/eslint/curated-rules.ts'),
            'utf8',
        );
        // Sliced to the CURATED array: the exclusions below it carry the same
        // `ruleId:` shape, and planting a violation of a rule the preset
        // deliberately withholds would be the opposite of the property here.
        // Anchored on the DECLARATIONS — both names appear in prose above the
        // code, so a bare name search can start the slice in a doc comment or
        // end it inside the array it is meant to cover.
        const curatedBlock = manifest.slice(
            manifest.indexOf('export const STANDALONE_LINT_RULES'),
            manifest.indexOf('export const STANDALONE_LINT_EXCLUSIONS'),
        );
        // Per ENTRY, not per rule id: the entry says which zone kinds the rule
        // covers, and a rule with two arms needs a plant in each. Splitting on
        // `ruleId:` gives one chunk per entry, running to the next entry.
        const entries = curatedBlock
            .split('ruleId: ')
            .slice(1)
            .map((chunk) => ({
                ruleId: /^'(chimera\/[a-z-]+)'/u.exec(chunk)?.[1] ?? '',
                lintsCss: chunk.includes('cssZones:'),
                lintsCode: chunk.includes('zones: '),
            }));
        const curated = entries.map((entry) => entry.ruleId);
        const plants = [
            ...PROBE_LINT_PLANTS.map((plant) => ({ rel: plant.rel, ruleId: plant.ruleId })),
            { rel: 'styles/tokens-override.css', ruleId: PROBE_UNKNOWN_TOKEN_RULE },
        ];
        const planted = new Set(plants.map((plant) => plant.ruleId));

        // Floor: a manifest that parsed to nothing would satisfy the subset
        // check below vacuously.
        expect(curated.length).toBeGreaterThan(3);
        expect([...planted].filter((ruleId) => !curated.includes(ruleId))).toEqual([]);
        expect(curated.filter((ruleId) => !planted.has(ruleId))).toEqual([]);

        // Every ARM, not just every rule. `no-hardcoded-design-values` is one id
        // over two zone kinds, so a rule-id set alone stays green after the CSS
        // plant is dropped — and that arm is the one a JS-only base silently
        // aborts.
        const plantedCss = new Set(
            plants.filter((plant) => plant.rel.endsWith('.css')).map((plant) => plant.ruleId),
        );
        const plantedCode = new Set(
            plants.filter((plant) => !plant.rel.endsWith('.css')).map((plant) => plant.ruleId),
        );
        expect(entries.filter((entry) => entry.lintsCss && !plantedCss.has(entry.ruleId))).toEqual(
            [],
        );
        expect(
            entries.filter((entry) => entry.lintsCode && !plantedCode.has(entry.ruleId)),
        ).toEqual([]);
        // …and the two kinds are both really present, so neither filter above is
        // vacuous.
        expect(entries.filter((entry) => entry.lintsCss).length).toBeGreaterThan(0);
        expect(entries.filter((entry) => entry.lintsCode).length).toBeGreaterThan(0);
    });

    it('runs the lint arm: subpath resolution, a clean pass, and planted violations that FAIL', async () => {
        const { fs, files, removed } = makeFakeFs();
        const { run, calls } = makeFakeRun(files, TMP_ROOT);
        const logged: string[] = [];

        const result = await verifyScaffold(makeDeps(run, fs, { log: (m) => logged.push(m) }));

        expect(result.ok).toBe(true);
        // Driven from the PROJECT ROOT, not `--filter`: the root forward is
        // half of what the arm proves, and a `--filter` call would exercise the
        // app script while leaving the forward untested.
        const lintCalls = calls.filter((call) => call.args[0] === 'lint');
        expect(lintCalls).toHaveLength(2);
        for (const call of lintCalls) expect(call.cwd).toBe(TMP_ROOT);
        // The planted run asks for the machine format. Without it the arm reads
        // a human blob, where a rule id from one file's block satisfies another
        // file's match.
        expect(lintCalls[1]?.args).toEqual(['lint', '-f', 'json']);
        // Resolved from the APP, not the project root. The root is where the
        // engine tarballs were installed, so a probe anchored there answers yes
        // for a subpath the app itself cannot reach.
        const probeCall = calls.find(
            (call) => call.cmd === 'node' && call.args.join(' ').includes('/eslint'),
        );
        expect(probeCall?.cwd).toBe(APP_DIR);
        // The report reaches the operator. `run` is captured here and echoes
        // only stderr, so without an explicit log a failing gate prints pnpm's
        // exit banner and none of the findings that explain it.
        expect(logged.some((message) => message.includes(PROBE_UNKNOWN_TOKEN_RULE))).toBe(true);
        // Every plant is removed again, and the real scaffolded stylesheet is
        // restored — a gate that leaves its probes behind poisons every later
        // step.
        for (const plant of PROBE_LINT_PLANTS) {
            expect(removed).toContain(path.join(APP_DIR, plant.rel));
        }
        expect(files.get(path.join(APP_DIR, 'styles', 'tokens-override.css'))).not.toContain(
            PROBE_UNKNOWN_TOKEN,
        );
    });

    it('reports lint when the @chimera-engine/electron/eslint subpath is not installed', async () => {
        const { fs, files } = makeFakeFs();
        // Bypass the default install seeding, then put back everything a correct
        // install leaves EXCEPT the preset entry — so every earlier arm still
        // passes and the step reported is the one under test.
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
            if (args[0] !== 'install') return undefined;
            seedInstallExcept(files, []);
            files.set(
                path.join(TMP_ROOT, 'apps', PROBE_GAME.kebab, 'package.json'),
                JSON.stringify({
                    name: PROBE_GAME.pkg,
                    scripts: {
                        'fetch:fonts': `chimera-fetch-fonts --game ${PROBE_GAME.kebab} --out-dir assets/fonts`,
                        'validate:assets': PROBE_VALIDATE_ASSETS_SCRIPT,
                        'icons:generate': PROBE_ICONS_GENERATE_SCRIPT,
                    },
                }),
            );
            return { status: 0, stdout: '', stderr: '' };
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
    });

    it('reports lint when the untouched scaffold already reports', async () => {
        // The half a game author feels first: guardrails that red on code
        // nobody wrote are guardrails the first author switches off.
        const { fs, files } = makeFakeFs();
        let seen = 0;
        const { run } = makeFakeRun(files, TMP_ROOT, (cmd, args) => {
            if (args[0] !== 'lint') return undefined;
            seen += 1;
            return seen === 1
                ? { status: 1, stdout: 'renderer/next-env.d.ts\n  3:1  error  x  y', stderr: '' }
                : undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
    });

    /**
     * A full, correct planted report — every rule id, every plant's path. The
     * three tests below each break exactly ONE thing in it, so the assertion
     * that reds names the property under test rather than whichever guard
     * happened to fire first.
     */
    const plantedFindings = (): { rel: string; ruleId: string }[] => [
        ...PROBE_LINT_PLANTS.map((plant) => ({ rel: plant.rel, ruleId: plant.ruleId })),
        { rel: 'styles/tokens-override.css', ruleId: PROBE_UNKNOWN_TOKEN_RULE },
    ];

    const fullPlantedReport = (): string => eslintJsonReport(APP_DIR, plantedFindings());

    /** Replaces the SECOND `pnpm lint` — the planted one — with `result`. */
    const plantedLintOverride =
        (result: RunResult) =>
        (): { override: (cmd: string, args: readonly string[]) => RunResult | undefined } => {
            let seen = 0;
            return {
                override: (_cmd, args) => {
                    if (args[0] !== 'lint') return undefined;
                    seen += 1;
                    return seen === 2 ? result : undefined;
                },
            };
        };

    it('reports lint when the planted run exits 0 while reporting everything', async () => {
        // Isolates the exit-code guard: the report is complete, so neither the
        // rule-id nor the per-file check can fire in its place.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedLintOverride({ status: 0, stdout: fullPlantedReport(), stderr: '' })().override,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
    });

    it('reports lint when one rule id is missing but every plant file is named', async () => {
        // Isolates the rule-id check. A rule that stopped firing while another
        // still reported in its file is exactly the silent half of the failure.
        const { fs, files } = makeFakeFs();
        const silenced = PROBE_LINT_PLANTS[0]?.ruleId ?? '';
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedLintOverride({
                status: 1,
                stdout: fullPlantedReport().split(silenced).join('some-other-rule'),
                stderr: '',
            })().override,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
    });

    it('reports lint when the TOKEN rule stays silent (Invariant #85)', async () => {
        // The token plant is the only one not in PROBE_LINT_PLANTS, so it is the
        // one a per-plant loop would miss.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedLintOverride({
                status: 1,
                stdout: fullPlantedReport().split(PROBE_UNKNOWN_TOKEN_RULE).join('some-other-rule'),
                stderr: '',
            })().override,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
    });

    it('reports lint when a rule id appears but its plant file does not', async () => {
        // Isolates the per-file check. One rule firing five times reads
        // identically to five rules firing once, unless the FILES are read too.
        const { fs, files } = makeFakeFs();
        const dropped = PROBE_LINT_PLANTS[1];
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedLintOverride({
                status: 1,
                stdout: fullPlantedReport()
                    .split(path.basename(dropped?.rel ?? ''))
                    .join('elsewhere.tsx'),
                stderr: '',
            })().override,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
    });

    it('reports lint when the planted violations STILL exit 0 (the gate is vacuous)', async () => {
        // The arm's reason for existing. A clean pass is equally produced by a
        // config whose zone globs match nothing at all.
        const { fs, files } = makeFakeFs();
        let seen = 0;
        const { run } = makeFakeRun(files, TMP_ROOT, (cmd, args) => {
            if (args[0] !== 'lint') return undefined;
            seen += 1;
            return seen === 2 ? { status: 0, stdout: '', stderr: '' } : undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
    });

    it('reports lint when every rule and every file is named but PAIRED WRONG', async () => {
        // Every rule id appears and every path appears, but no finding carries
        // its own rule. Read as one flat blob this is a passing report. It is
        // the failure a zone glob widened by accident produces, and the two
        // design-value plants land on it exactly, since they share a rule id and
        // differ only by file.
        //
        // Rotated by TWO: those two plants sit adjacent, so a one-step rotation
        // hands one of them back its own rule id and the fixture stops being
        // what this comment says it is.
        const { fs, files } = makeFakeFs();
        const rotated = plantedFindings();
        const ROTATION = 2;
        const misplaced = rotated.map((finding, index) => ({
            rel: finding.rel,
            ruleId: rotated[(index + ROTATION) % rotated.length]?.ruleId ?? '',
        }));
        // Every pairing really is wrong. Two plants share a rule id, so the
        // wrong rotation quietly hands one of them back its own — and the
        // fixture would then prove less than this test claims.
        expect(misplaced.filter((f, index) => f.ruleId === rotated[index]?.ruleId)).toEqual([]);

        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedLintOverride({
                status: 1,
                stdout: eslintJsonReport(APP_DIR, misplaced),
                stderr: '',
            })().override,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
    });

    it('reads the report from STDOUT, so a bracketed stderr line cannot break it', async () => {
        // Node writes deprecation warnings to stderr, bracketed and unbidden.
        // Concatenating the two streams puts one after the JSON, which moves the
        // closing-bracket search past the array — a gate that fails on a correct
        // scaffold, on some runners and not others.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedLintOverride({
                status: 1,
                stdout: fullPlantedReport(),
                stderr: '(node:1) [DEP0040] DeprecationWarning: `punycode` is deprecated.\n',
            })().override,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(true);
    });

    it('quotes STDERR in the failure when the planted run crashed with an empty stdout', async () => {
        // The excerpt and the slice read different streams on purpose. ESLint
        // crashing on a bad config writes nothing to stdout and everything to
        // stderr, so an excerpt taken from the parsed stream would report "no
        // JSON report" and quote the empty string — leaving the operator the
        // one message that explains it.
        const { fs, files } = makeFakeFs();
        const crash = 'Error: Could not find plugin "chimera" in configuration.';
        const logged: string[] = [];
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedLintOverride({ status: 2, stdout: '', stderr: `${crash}\n` })().override,
        );

        const result = await verifyScaffold(
            makeDeps(run, fs, { log: (message) => logged.push(message) }),
        );

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
        // The step FAILURE names it, not just the earlier report dump — that dump
        // is one `deps.log` among many in a long run, and the failure line is
        // what an operator reads first.
        expect(
            logged.filter((message) => message.includes('step "lint"') && message.includes(crash)),
        ).toHaveLength(1);
    });

    it('reports lint when the planted run prints no JSON report at all', async () => {
        // A `-f json` that silently stopped reaching ESLint (a dropped flag, a
        // forward that swallows trailing args) leaves a non-zero exit and a
        // human-format blob. Parsing that to an empty finding set and passing
        // would make the whole arm depend on the exit code alone.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedLintOverride({
                status: 1,
                stdout: PROBE_LINT_PLANTS.map(
                    (plant) => `${path.join(APP_DIR, plant.rel)}\n  1:1  error  x  ${plant.ruleId}`,
                ).join('\n'),
                stderr: '',
            })().override,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('lint');
    });

    it('reports validate-assets when the CLEAN run fails, even though it printed a count', async () => {
        // Isolates the clean run's exit-code assertion: the count guard is
        // satisfied and the planted run behaves correctly, so nothing else
        // could catch this.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            cleanRunOverride(files, {
                status: 1,
                stdout: '[validate-assets] Checked 3 asset refs; all files exist.\n',
                stderr: '',
            }),
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('validate-assets');
    });

    it('reports validate-assets when the clean run flags renderer-public assets (should be a no-op)', async () => {
        // A standalone project root has no renderer/public/assets, so that
        // check scans an empty set. Anything it reports there is spurious.
        //
        // The fixture is the shape the REAL tool emits — exit 1 WITH the
        // heading, since it only prints that heading inside a failing report.
        // That makes the arm's guard ordering observable: checked before
        // `assertStepOk` the failure names the renderer-public finding, checked
        // after it the exit code wins and the message is a generic one. Asserted
        // on the logged message, because `failedStep` is identical either way.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            cleanRunOverride(files, {
                status: 1,
                stdout:
                    '[validate-assets] Asset validation failed.\n' +
                    'Renderer-public game assets are forbidden:\n',
                stderr: '',
            }),
        );
        const logged: string[] = [];

        const result = await verifyScaffold(
            makeDeps(run, fs, { log: (message) => logged.push(message) }),
        );

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('validate-assets');
        expect(logged.join('\n')).toContain('flagged renderer-public game assets');
    });

    it('reports validate-assets when the installed electron manifest omits the typescript dependency', async () => {
        // The under-declaration proof, read off the manifest a consumer
        // installs rather than off a resolution — see the arm's own comment at
        // that step for why no resolution could stand in for it.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
            if (args[0] === 'install') {
                // Install everything the arm needs EXCEPT the declaration.
                files.set(
                    path.join(APP_DIR, 'node_modules', '.bin', 'chimera-fetch-fonts'),
                    '#!node',
                );
                files.set(
                    path.join(APP_DIR, 'node_modules', '.bin', 'chimera-validate-assets'),
                    '#!node',
                );
                files.set(
                    path.join(ELECTRON_REAL_DIR, 'package.json'),
                    JSON.stringify({ name: '@chimera-engine/electron', dependencies: {} }),
                );
                files.set(path.join(ELECTRON_REAL_DIR, 'node_modules', 'typescript'), 'link');
                return { status: 0, stdout: '', stderr: '' };
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('validate-assets');
    });

    it('reports validate-assets when the planted run fails without naming the broken ref', async () => {
        // A non-zero exit alone would also be produced by the planted JSON
        // crashing the tool. The failure has to be ABOUT the ref.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(
            files,
            TMP_ROOT,
            plantedRunOverride(files, {
                status: 1,
                stdout: '',
                stderr: 'SyntaxError: Unexpected token\n',
            }),
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('validate-assets');
    });

    it('runs the generate-icons arm: bin reachable, no codec installed, actionable failure', async () => {
        // The happy path for this arm is a FAILING run — a codec-absent
        // invocation that reports what to install. That is the shape a real
        // adopter hits first, and the shape that proves reachability cost the
        // game no install weight.
        const { fs, files } = makeFakeFs();
        const { run, calls } = makeFakeRun(files, TMP_ROOT);

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(true);
        // Invoked through the app SCRIPT, so pnpm resolves the bare bin name
        // through `node_modules/.bin` — the symlink an entry guard comparing
        // raw paths silently no-ops on.
        expect(
            calls.some((call) => call.cmd === 'pnpm' && call.args.includes('icons:generate')),
        ).toBe(true);
    });

    it('pins the probe’s hoisting before installing, so the tree is the scaffold’s not the runner’s', async () => {
        // Without this the generate-icons arm's absence checks depend on the
        // machine: hoisting enabled in a developer's or CI runner's `~/.npmrc`
        // links every transitive into the project root, and the arm reads Next's
        // `sharp` there as a declaration the scaffold never made.
        //
        // Read as `pnpm install` SAW it, not at the end of the run: an `.npmrc`
        // written afterwards is inert, and a file-at-the-end assertion cannot
        // tell that apart from a correct one.
        const { fs, files } = makeFakeFs();
        const { run, installNpmrc } = makeFakeRun(files, TMP_ROOT);

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(true);
        // Two assertions, because either alone is blind to half the property.
        // This one pins WHEN: comparing against the constant cannot see a
        // content change, but it does see a write that happened too late.
        expect(installNpmrc()).toBe(PROBE_NPMRC);

        // And this one pins WHAT, as a literal. Only `shamefully-hoist=false`
        // neutralises an ambient `shamefully-hoist=true` — measured against real
        // installs, which is how the first version of this pin was found inert.
        // Asserted against the constant instead, any line could be dropped
        // silently; see `PROBE_NPMRC` for what each one is for.
        expect(PROBE_NPMRC).toBe(
            'shamefully-hoist=false\npublic-hoist-pattern=\nnode-linker=isolated\n',
        );
    });

    it('pins BOTH flags of the expected app script, not just the one a test happens to drop', () => {
        // The constant is what every other assertion here compares against, so
        // a half of it that no test reads can drift silently. `--out`'s half is
        // covered by the mutation below; this covers `--source`'s.
        expect(PROBE_ICONS_GENERATE_SCRIPT).toBe(
            'chimera-generate-icons --source assets/icons/icon.png --out assets/icons',
        );
    });

    it('reports generate-icons when the app script drops --out (silent wrong-path write)', async () => {
        // The omission that does NOT refuse at runtime: the bin's `--out`
        // default is `electron/assets/icons` relative to cwd, a game HAS an
        // electron/ directory, so eleven files land in its main-process source
        // tree and the run exits 0. Only the script-shape check can catch it.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(files, TMP_ROOT);
        // Applied AFTER the scaffold CLI seeds the app manifest, which is the
        // only point at which there is a script to weaken.
        const patched: RunFn = (cmd, args, opts) => {
            const result = run(cmd, args, opts);
            if (cmd === 'tsx' && args.some((arg) => arg.includes('create-chimera-game'))) {
                const appPkgPath = path.join(APP_DIR, 'package.json');
                const pkg = JSON.parse(files.get(appPkgPath) ?? '{}') as {
                    scripts: Record<string, string>;
                };
                pkg.scripts['icons:generate'] =
                    'chimera-generate-icons --source assets/icons/icon.png';
                files.set(appPkgPath, JSON.stringify(pkg));
            }
            return result;
        };

        const result = await verifyScaffold(makeDeps(patched, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('generate-icons');
    });

    it('reports generate-icons when the bin is not linked under the app node_modules/.bin', async () => {
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
            if (args[0] === 'install') {
                // Everything the earlier arms need, minus this one's bin.
                seedInstallExcept(files, ['chimera-generate-icons']);
                return { status: 0, stdout: '', stderr: '' };
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('generate-icons');
    });

    it.each([
        ['sharp', 'app', () => path.join(APP_DIR, 'node_modules', 'sharp')],
        ['sharp', 'project root', () => path.join(TMP_ROOT, 'node_modules', 'sharp')],
        ['png2icons', 'app', () => path.join(APP_DIR, 'node_modules', 'png2icons')],
        ['png2icons', 'project root', () => path.join(TMP_ROOT, 'node_modules', 'png2icons')],
    ] as const)(
        'reports generate-icons when %s was declared into the %s node_modules',
        async (_codec, _where, location) => {
            // The install-weight regression, and the one a passing bin run would
            // HIDE: with the codec present the tool SUCCEEDS, so only an explicit
            // absence check can see that a project now asks for it.
            //
            // Both codecs in both trees. Under pnpm's isolated linker a
            // project's own node_modules holds exactly what it declared, so
            // either location is a direct declaration — which is the defect this
            // arm found on its first run, in the project root.
            const { fs, files } = makeFakeFs();
            const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
                if (args[0] === 'install') {
                    seedInstallExcept(files, []);
                    files.set(location(), 'declared');
                    return { status: 0, stdout: '', stderr: '' };
                }
                return undefined;
            });

            const result = await verifyScaffold(makeDeps(run, fs));

            expect(result.ok).toBe(false);
            expect(result.failedStep).toBe('generate-icons');
        },
    );

    it.each([
        // Non-empty stdout on the failing case, so each conjunct is the only
        // thing that can catch its own fixture. A failing run that also printed
        // nothing would trip both, and either check could then be deleted.
        ['fails', { status: 1, stdout: '/partial/path', stderr: 'ENOENT' }],
        ['succeeds with empty output', { status: 0, stdout: '   \n', stderr: '' }],
    ] as const)(
        'fails the reading arm when resolving the installed electron dir %s',
        async (_label, resolution) => {
            // Empty stdout is the quieter half: `path.join('', 'package.json')`
            // is a path relative to the GATE's cwd, so the read either throws an
            // unnamed error — which escapes the step-error contract entirely —
            // or grades a manifest belonging to something else.
            const { fs, files } = makeFakeFs();
            const { run } = makeFakeRun(files, TMP_ROOT, (cmd, args) =>
                cmd === 'node' && args[1]?.includes('realpathSync') === true
                    ? resolution
                    : undefined,
            );

            const result = await verifyScaffold(makeDeps(run, fs));

            expect(result.ok).toBe(false);
            // validate-assets reads the same manifest through the same helper and
            // runs first, so it is the step that reports — which is the point:
            // the helper fails as its CALLER's step rather than escaping.
            expect(result.failedStep).toBe('validate-assets');
        },
    );

    it('reports generate-icons when the codec-absent run exits 0 (the no-op entry guard)', async () => {
        // Exactly what a bare `path.resolve` entry gate produces through a pnpm
        // bin shim: exit 0, nothing written, nothing said. Without this the arm
        // would read that silence as success.
        //
        // Asserted on the LOGGED message, not just the step: silence also trips
        // the actionable-message check further down, so `failedStep` alone
        // cannot tell "the guard no-opped" from "the message was wrong" — and
        // this test would then pass with the exit-code check deleted.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) =>
            args.includes('icons:generate') ? { status: 0, stdout: '', stderr: '' } : undefined,
        );
        const logged: string[] = [];

        const result = await verifyScaffold(
            makeDeps(run, fs, { log: (message) => logged.push(message) }),
        );

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('generate-icons');
        expect(logged.join('\n')).toContain('exited 0 without png2icons');
    });

    it('reports generate-icons when the run fails without the actionable message', async () => {
        // A non-zero exit alone is also what a bin that failed to LOAD produces.
        // The failure has to be the one that tells an author what to install.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) =>
            args.includes('icons:generate')
                ? {
                      status: 1,
                      stdout: '',
                      stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'sharp'\n",
                  }
                : undefined,
        );

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('generate-icons');
    });

    it.each([
        ['declares a codec as a runtime dependency', { sharp: '^0.35.2' }, true],
        ['declares no codec peer at all', undefined, false],
    ] as const)(
        'reports generate-icons when the installed electron manifest %s',
        async (_label, dependencies, keepPeers) => {
            const { fs, files } = makeFakeFs();
            const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
                if (args[0] === 'install') {
                    seedInstallExcept(files, []);
                    files.set(
                        path.join(ELECTRON_REAL_DIR, 'package.json'),
                        JSON.stringify({
                            name: '@chimera-engine/electron',
                            dependencies: { typescript: '^5.7.2', ...dependencies },
                            ...(keepPeers
                                ? {
                                      peerDependencies: {
                                          sharp: '^0.35.2',
                                          png2icons: '^2.0.1',
                                      },
                                      peerDependenciesMeta: {
                                          sharp: { optional: true },
                                          png2icons: { optional: true },
                                      },
                                  }
                                : {}),
                        }),
                    );
                    return { status: 0, stdout: '', stderr: '' };
                }
                return undefined;
            });

            const result = await verifyScaffold(makeDeps(run, fs));

            expect(result.ok).toBe(false);
            expect(result.failedStep).toBe('generate-icons');
        },
    );

    it('reports generate-icons when the optional flag is there but the peer entry is not', async () => {
        // The other conjunct of "declared as an OPTIONAL peer". Absent the peer
        // entry an author gets no version range for a package the tool needs,
        // and nothing validates a copy they do install. Fixture keeps the
        // `optional` meta so the sibling check below cannot stand in for this
        // one — a manifest with neither is caught by that check alone.
        const { fs, files } = makeFakeFs();
        const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
            if (args[0] === 'install') {
                seedInstallExcept(files, []);
                files.set(
                    path.join(ELECTRON_REAL_DIR, 'package.json'),
                    JSON.stringify({
                        name: '@chimera-engine/electron',
                        dependencies: { typescript: '^5.7.2' },
                        peerDependencies: { png2icons: '^2.0.1' },
                        peerDependenciesMeta: {
                            sharp: { optional: true },
                            png2icons: { optional: true },
                        },
                    }),
                );
                return { status: 0, stdout: '', stderr: '' };
            }
            return undefined;
        });

        const result = await verifyScaffold(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('generate-icons');
    });

    it.each([
        ['meta entry absent', undefined],
        ['optional explicitly false', { optional: false }],
    ] as const)(
        'reports generate-icons when a codec peer is not optional (%s)',
        async (_label, sharpMeta) => {
            // The single flag the whole lean-install claim rests on, and the ONLY
            // guard on this branch that observes it — nothing at install time
            // does, since pnpm places an auto-installed peer under `.pnpm`
            // rather than in the app's own node_modules.
            //
            // Both shapes, because a check comparing against `undefined` rather
            // than `!== true` passes the explicit-false manifest, which is the
            // one a hand-edit produces.
            const { fs, files } = makeFakeFs();
            const { run } = makeFakeRun(files, TMP_ROOT, (_cmd, args) => {
                if (args[0] === 'install') {
                    seedInstallExcept(files, []);
                    files.set(
                        path.join(ELECTRON_REAL_DIR, 'package.json'),
                        JSON.stringify({
                            name: '@chimera-engine/electron',
                            dependencies: { typescript: '^5.7.2' },
                            peerDependencies: { sharp: '^0.35.2', png2icons: '^2.0.1' },
                            peerDependenciesMeta: {
                                ...(sharpMeta === undefined ? {} : { sharp: sharpMeta }),
                                png2icons: { optional: true },
                            },
                        }),
                    );
                    return { status: 0, stdout: '', stderr: '' };
                }
                return undefined;
            });

            const result = await verifyScaffold(makeDeps(run, fs));

            expect(result.ok).toBe(false);
            expect(result.failedStep).toBe('generate-icons');
        },
    );

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
