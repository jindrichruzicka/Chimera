// tools/verify-pack.test.ts
//
// Unit tests for the `verify:pack` true-artifact release gate.
//
// Exercises the pure wiring — package list, pack argv + tarball-path parsing, the
// throwaway consumer manifest (file: deps + overrides, no workspace:* leak), the
// renderer-barrel resolution probe script, the scoped Playwright invocation, and
// the verifyPack / verifyPackSelfTest orchestration — with injected fakes, so no
// real pnpm, npm, playwright, electron, or filesystem is touched.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
    CHIMERA_PACKAGES,
    RENDERER_PEERS,
    E2E_NODE_MODULES_ENV,
    PROBE_SUBPATHS,
    parsePackTarballPath,
    readPeerVersions,
    buildConsumerManifest,
    buildProbeScript,
    e2ePlaywrightArgs,
    missingProbeSubpaths,
    packAll,
    verifyPack,
    verifyPackSelfTest,
    type RunFn,
    type RunResult,
    type FsLike,
    type VerifyPackDeps,
} from './verify-pack.js';

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

/**
 * A programmable RunFn. By default every command succeeds; `pnpm pack` calls
 * echo a deterministic tarball path into the `--pack-destination` dir so the
 * parser has something to read. Per-test overrides force a failure on a step.
 */
interface RecordedCall {
    cmd: string;
    args: readonly string[];
    cwd?: string | undefined;
    env?: Readonly<Record<string, string | undefined>> | undefined;
}

function makeFakeRun(
    overrides: (cmd: string, args: readonly string[]) => RunResult | undefined = () => undefined,
): { run: RunFn; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const run: RunFn = (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts?.cwd, env: opts?.env });
        const override = overrides(cmd, args);
        if (override !== undefined) return override;
        if (args[0] === 'pack') {
            const destIdx = args.indexOf('--pack-destination');
            const dest = destIdx >= 0 ? args[destIdx + 1] : '.';
            // Derive a tarball name from the package dir (cwd), like pnpm does.
            const slug = path.basename(opts?.cwd ?? 'pkg');
            return {
                status: 0,
                stdout: `${path.join(dest ?? '.', `chimera-${slug}-0.9.0.tgz`)}\n`,
                stderr: '',
            };
        }
        return { status: 0, stdout: '', stderr: '' };
    };
    return { run, calls };
}

function makeDeps(run: RunFn, fs: FsLike, extra: Partial<VerifyPackDeps> = {}): VerifyPackDeps {
    return {
        run,
        fs,
        log: () => {},
        repoRoot: '/repo',
        peerVersions: {
            next: '^15',
            react: '^19',
            'react-dom': '^19',
            three: '^0.184',
            '@react-three/fiber': '^9',
        },
        ...extra,
    };
}

/**
 * The exports keys the packed renderer manifest ships today. The real gate
 * derives coverage from the manifest inside the installed tarball, so drift here
 * surfaces at `verify:pack` — this suite exercises the derivation, not the manifest.
 * The no-gap case below is only as strong as this mirror: a key missing here is a
 * key that case never asks `PROBE_SUBPATHS` to cover.
 */
const RENDERER_EXPORTS: Readonly<Record<string, unknown>> = {
    './components/ui': { default: './dist/components/ui/index.js' },
    './components/chat': { default: './dist/components/chat/index.js' },
    './components/r3f': { default: './dist/components/r3f/index.js' },
    './i18n': { default: './dist/i18n/index.js' },
    './audio': { default: './dist/audio/index.js' },
    './assets': { default: './dist/assets/index.js' },
    './input': { default: './dist/input/index.js' },
    './game': { default: './dist/game/rendererGameRegistry.js' },
    './shell/*': { default: './dist/app/*.js' },
    './styles/*.css': './dist/styles/*.css',
};

/** Where the completeness gate reads the installed renderer manifest in the fake
 * consumer (the fake mkdtemp names the first temp dir `<prefix>1`). */
function installedRendererManifestPath(): string {
    const tmp = `${path.join(tmpdir(), 'chimera-verify-pack-')}1`;
    return path.join(tmp, 'consumer', 'node_modules', '@chimera-engine/renderer', 'package.json');
}

/** Seed the manifest npm extracts from the renderer tarball into the fake consumer. */
function seedInstalledRendererManifest(
    files: Map<string, string>,
    exportsMap: Readonly<Record<string, unknown>> = RENDERER_EXPORTS,
): void {
    files.set(
        installedRendererManifestPath(),
        JSON.stringify({ name: '@chimera-engine/renderer', exports: exportsMap }),
    );
}

// ── Package list ──────────────────────────────────────────────────────────────

describe('CHIMERA_PACKAGES', () => {
    it('lists the five engine packages in inward dependency order, not the consumer app', () => {
        expect(CHIMERA_PACKAGES.map((p) => p.name)).toEqual([
            '@chimera-engine/simulation',
            '@chimera-engine/ai',
            '@chimera-engine/networking',
            '@chimera-engine/renderer',
            '@chimera-engine/electron',
        ]);
        expect(CHIMERA_PACKAGES.map((p) => p.dir)).toEqual([
            'simulation',
            'ai',
            'networking',
            'renderer',
            'electron',
        ]);
        // apps/tactics is the consumer, never a packed artifact.
        expect(CHIMERA_PACKAGES.map((p) => String(p.name))).not.toContain(
            '@chimera-engine/tactics',
        );
    });
});

// ── parsePackTarballPath ────────────────────────────────────────────────────

describe('parsePackTarballPath', () => {
    it('returns an absolute path printed by pnpm verbatim', () => {
        const out = '/tmp/x/tarballs/chimera-simulation-0.9.0.tgz\n';
        expect(parsePackTarballPath(out, '/tmp/x/tarballs')).toBe(
            '/tmp/x/tarballs/chimera-simulation-0.9.0.tgz',
        );
    });

    it('resolves a bare tarball filename against the pack destination', () => {
        expect(parsePackTarballPath('chimera-ai-0.9.0.tgz\n', '/tmp/x/tarballs')).toBe(
            path.join('/tmp/x/tarballs', 'chimera-ai-0.9.0.tgz'),
        );
    });

    it('picks the last .tgz line when pnpm prints extra noise', () => {
        const out = 'npm notice\nfoo\n/tmp/x/tarballs/chimera-renderer-0.9.0.tgz\n';
        expect(parsePackTarballPath(out, '/tmp/x/tarballs')).toBe(
            '/tmp/x/tarballs/chimera-renderer-0.9.0.tgz',
        );
    });
});

// ── readPeerVersions ─────────────────────────────────────────────────────────

describe('readPeerVersions', () => {
    it('reads the renderer peer ranges from the root package.json (deps + devDeps merged)', () => {
        const rootPkg = {
            dependencies: { three: '^0.184.0', '@react-three/fiber': '^9.6.1' },
            devDependencies: { next: '^15.5.15', react: '^19.2.5', 'react-dom': '^19.2.5' },
        };
        const versions = readPeerVersions(rootPkg);
        for (const peer of RENDERER_PEERS) {
            expect(versions[peer]).toBeDefined();
        }
        expect(versions['three']).toBe('^0.184.0');
        expect(versions['next']).toBe('^15.5.15');
    });
});

// ── buildConsumerManifest ────────────────────────────────────────────────────

describe('buildConsumerManifest', () => {
    const tarballs = {
        '@chimera-engine/simulation': '/t/chimera-simulation-0.9.0.tgz',
        '@chimera-engine/ai': '/t/chimera-ai-0.9.0.tgz',
        '@chimera-engine/networking': '/t/chimera-networking-0.9.0.tgz',
        '@chimera-engine/renderer': '/t/chimera-renderer-0.9.0.tgz',
        '@chimera-engine/electron': '/t/chimera-electron-0.9.0.tgz',
    };
    const peers = {
        next: '^15',
        react: '^19',
        'react-dom': '^19',
        three: '^0.184',
        '@react-three/fiber': '^9',
    };

    it('maps every @chimera-engine/* package to its file: tarball in dependencies', () => {
        const manifest = buildConsumerManifest(tarballs, peers);
        for (const [name, tgz] of Object.entries(tarballs)) {
            expect(manifest.dependencies[name]).toBe(`file:${tgz}`);
        }
    });

    it('forces every @chimera-engine/* edge through the tarball via npm overrides', () => {
        const manifest = buildConsumerManifest(tarballs, peers);
        for (const [name, tgz] of Object.entries(tarballs)) {
            expect(manifest.overrides[name]).toBe(`file:${tgz}`);
        }
    });

    it('includes the renderer peers so the packed renderer surface resolves cleanly', () => {
        const manifest = buildConsumerManifest(tarballs, peers);
        for (const peer of RENDERER_PEERS) {
            expect(manifest.dependencies[peer]).toBe(peers[peer]);
        }
    });

    it('leaks no workspace:* spec anywhere (the whole point of the gate)', () => {
        const manifest = buildConsumerManifest(tarballs, peers);
        const serialised = JSON.stringify(manifest);
        expect(serialised).not.toContain('workspace:');
        expect(manifest.private).toBe(true);
    });
});

// ── buildProbeScript ─────────────────────────────────────────────────────────

describe('buildProbeScript', () => {
    it('asserts the two public renderer barrels + game seam resolve from the tarball', () => {
        const script = buildProbeScript();
        expect(script).toContain('@chimera-engine/renderer/components/ui');
        expect(script).toContain('@chimera-engine/renderer/components/chat');
        expect(script).toContain('@chimera-engine/renderer/game');
    });

    it('asserts the renderer CSS subpaths ship via files', () => {
        const script = buildProbeScript();
        expect(script).toContain('@chimera-engine/renderer/styles/tokens.css');
        expect(script).toContain('@chimera-engine/renderer/styles/animations.css');
    });

    it('asserts the electron public surface (main + preload api) resolves from the tarball', () => {
        const script = buildProbeScript();
        expect(script).toContain('@chimera-engine/electron/main');
        expect(script).toContain('@chimera-engine/electron/preload/api');
    });

    it('asserts the r3f and i18n barrels (Invariant #96) resolve from the tarball', () => {
        const script = buildProbeScript();
        expect(script).toContain('@chimera-engine/renderer/components/r3f');
        expect(script).toContain('@chimera-engine/renderer/i18n');
    });

    it('is resolution-based (createRequire / require.resolve), not a runtime render', () => {
        const script = buildProbeScript();
        expect(script).toContain('createRequire');
        expect(script).toContain('require.resolve');
    });
});

// ── PROBE_SUBPATHS coverage of what a scaffolded game actually resolves ──────

describe("PROBE_SUBPATHS covers what a scaffolded game's ELECTRON BUILD imports", () => {
    // `missingProbeSubpaths` derives completeness from the packed RENDERER
    // manifest only (Invariant #96), which is deliberate — electron's exports
    // map also carries dev-only and types-only entries outside that surface. The
    // consequence is that an electron entry can be deleted from the list and
    // nothing notices, which is how the `build-main` probe would silently stop
    // guarding the subpath a scaffolded game's `build:app` dies without.
    //
    // Scope is exactly what the title says and no more: static `from '…'`
    // specifiers under the template's `electron/` tree, whatever they turn out to
    // be. Those run before anything else in a scaffolded game and fail with an
    // unhelpful `ERR_PACKAGE_PATH_NOT_EXPORTED` if the surface is broken. The template
    // reaches other engine subpaths elsewhere (`./eslint` from its flat config,
    // `./test-support` from a unit test, `./preload/api` through a
    // `createRequire` string); those are covered by `verify:scaffold`, which
    // installs the packed tarballs and runs the generated app's real scripts. No
    // attempt is made to unify the two — this one is cheap and runs on every
    // commit, that one is the end-to-end truth.
    const TEMPLATE_ELECTRON_DIR = path.resolve(
        import.meta.dirname,
        'create-chimera-game/templates/blank/electron',
    );

    /** Every `.ts` under `dir`. */
    const templateSources = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return templateSources(full);
            return entry.name.endsWith('.ts') ? [full] : [];
        });

    const requiredSubpaths = (): string[] => {
        const found = new Set<string>();
        for (const file of templateSources(TEMPLATE_ELECTRON_DIR)) {
            const source = readFileSync(file, 'utf8');
            for (const match of source.matchAll(/from '(@chimera-engine\/electron\/[^']+)'/gu)) {
                if (match[1] !== undefined) found.add(match[1]);
            }
        }
        return [...found].sort();
    };

    it('reads a non-empty required set out of the template (guards the derivation)', () => {
        // A template whose Electron sources stopped importing the engine — or a
        // pattern that stopped matching — would make the case below vacuous.
        expect(requiredSubpaths()).toContain('@chimera-engine/electron/build-main');
    });

    it('probes every one of them from the packed artifact', () => {
        const missing = requiredSubpaths().filter(
            (subpath) => !(PROBE_SUBPATHS as readonly string[]).includes(subpath),
        );
        expect(
            missing,
            "a scaffolded game's Electron build imports these from @chimera-engine/electron, " +
                'but verify:pack never resolves them from the packed tarball — a dropped ' +
                'exports/files entry would surface as ERR_PACKAGE_PATH_NOT_EXPORTED in an ' +
                "adopter's build:app",
        ).toEqual([]);
    });
});

// ── missingProbeSubpaths (probe-list completeness derivation) ────────────────

describe('missingProbeSubpaths', () => {
    it('reports no gap: every packed renderer exports key is covered by the shipped list', () => {
        expect(
            missingProbeSubpaths('@chimera-engine/renderer', RENDERER_EXPORTS, PROBE_SUBPATHS),
        ).toEqual([]);
    });

    it('treats a wildcard key as covered by a concrete probe entry matching its pattern', () => {
        expect(
            missingProbeSubpaths('@chimera-engine/renderer', { './shell/*': {} }, [
                '@chimera-engine/renderer/shell/layout',
            ]),
        ).toEqual([]);
    });

    it('reports an unprobed exports key by name', () => {
        expect(
            missingProbeSubpaths(
                '@chimera-engine/renderer',
                { ...RENDERER_EXPORTS, './models': {} },
                PROBE_SUBPATHS,
            ),
        ).toEqual(['./models']);
    });

    it('does not count a probe entry under a different prefix as covering a wildcard key', () => {
        expect(
            missingProbeSubpaths('@chimera-engine/renderer', { './shell/*': {} }, [
                '@chimera-engine/renderer/styles/tokens.css',
            ]),
        ).toEqual(['./shell/*']);
    });

    it('requires the wildcard suffix to match and the * to consume at least one character', () => {
        // Missing the `.css` suffix → not a representative of `./styles/*.css`.
        expect(
            missingProbeSubpaths('@chimera-engine/renderer', { './styles/*.css': {} }, [
                '@chimera-engine/renderer/styles/tokens',
            ]),
        ).toEqual(['./styles/*.css']);
        // Prefix + suffix with an empty middle names no real file under the pattern.
        expect(
            missingProbeSubpaths('@chimera-engine/renderer', { './styles/*.css': {} }, [
                '@chimera-engine/renderer/styles/.css',
            ]),
        ).toEqual(['./styles/*.css']);
        // A genuine concrete file under the pattern is covered.
        expect(
            missingProbeSubpaths('@chimera-engine/renderer', { './styles/*.css': {} }, [
                '@chimera-engine/renderer/styles/tokens.css',
            ]),
        ).toEqual([]);
    });

    it('reports keys it cannot interpret (a conditions-only exports object) instead of passing them', () => {
        expect(
            missingProbeSubpaths(
                '@chimera-engine/renderer',
                { import: {}, default: {} },
                PROBE_SUBPATHS,
            ),
        ).toEqual(['import', 'default']);
    });

    it('covers a root "." key only by the bare package name, and exact keys only exactly', () => {
        expect(
            missingProbeSubpaths('@chimera-engine/simulation', { '.': {} }, [
                '@chimera-engine/simulation',
            ]),
        ).toEqual([]);
        expect(
            missingProbeSubpaths('@chimera-engine/simulation', { '.': {} }, [
                '@chimera-engine/simulation/engine',
            ]),
        ).toEqual(['.']);
        // A deeper probe entry does not stand in for the exact barrel key.
        expect(
            missingProbeSubpaths('@chimera-engine/renderer', { './audio': {} }, [
                '@chimera-engine/renderer/audio/AudioManager',
            ]),
        ).toEqual(['./audio']);
    });
});

// ── e2ePlaywrightArgs ────────────────────────────────────────────────────────

describe('e2ePlaywrightArgs', () => {
    it('targets the tactics electron-e2e project and excludes the non-public debug specs', () => {
        const args = e2ePlaywrightArgs();
        expect(args).toContain('--config=apps/tactics/e2e/playwright.config.ts');
        expect(args).toContain('--project=electron-e2e');
        const grepIdx = args.indexOf('--grep-invert');
        expect(grepIdx).toBeGreaterThanOrEqual(0);
        expect(args[grepIdx + 1]).toMatch(/debug/i);
    });
});

// ── packAll ──────────────────────────────────────────────────────────────────

describe('packAll', () => {
    it('packs each engine package into the destination and collects its tarball path', async () => {
        const { run, calls } = makeFakeRun();
        const { fs } = makeFakeFs();
        const tarballs = await packAll(makeDeps(run, fs), '/t/tarballs');

        const packCalls = calls.filter((c) => c.args[0] === 'pack');
        expect(packCalls).toHaveLength(CHIMERA_PACKAGES.length);
        for (const c of packCalls) {
            expect(c.cmd).toBe('pnpm');
            expect(c.args).toContain('--pack-destination');
            expect(c.args).toContain('/t/tarballs');
        }
        // pack is run from each package's own dir.
        expect(packCalls.map((c) => c.cwd)).toEqual([
            path.join('/repo', 'simulation'),
            path.join('/repo', 'ai'),
            path.join('/repo', 'networking'),
            path.join('/repo', 'renderer'),
            path.join('/repo', 'electron'),
        ]);
        expect(Object.keys(tarballs)).toEqual(CHIMERA_PACKAGES.map((p) => p.name));
    });
});

// ── verifyPack orchestration ─────────────────────────────────────────────────

describe('verifyPack', () => {
    it('runs build → pack → install → probe → e2e in order and cleans up', async () => {
        const { run, calls } = makeFakeRun();
        const { fs, files, removed } = makeFakeFs();
        seedInstalledRendererManifest(files);

        const result = await verifyPack(makeDeps(run, fs));

        expect(result.ok).toBe(true);
        const sequence = calls.map((c) => `${c.cmd} ${c.args[0]}`);
        // build:packages first, npm install before the node probe.
        expect(sequence[0]).toBe('pnpm build:packages');
        expect(sequence).toContain('npm install');
        expect(sequence).toContain('node probe.mjs');
        const installIdx = sequence.indexOf('npm install');
        const probeIdx = sequence.indexOf('node probe.mjs');
        expect(installIdx).toBeLessThan(probeIdx);
        // Playwright runs last, after the probe, with the tarball node_modules wired
        // into its env so global-setup flips esbuild resolution onto the artifacts.
        const pwIdx = calls.findIndex((c) => c.args.includes('playwright'));
        expect(pwIdx).toBeGreaterThanOrEqual(0);
        expect(calls[pwIdx]?.env?.[E2E_NODE_MODULES_ENV]).toBeDefined();
        const playwrightProbeIdx = calls.findIndex(
            (c) => c.cmd === 'node' && c.args[0] === 'probe.mjs',
        );
        expect(pwIdx).toBeGreaterThan(playwrightProbeIdx);
        // Temp dir removed on completion.
        expect(removed.length).toBeGreaterThan(0);
    });

    it('installs with --ignore-scripts in the throwaway consumer dir (no workspace ancestor)', async () => {
        const { run, calls } = makeFakeRun();
        const { fs, files } = makeFakeFs();
        seedInstalledRendererManifest(files);

        await verifyPack(makeDeps(run, fs));

        const install = calls.find((c) => c.cmd === 'npm' && c.args[0] === 'install');
        expect(install).toBeDefined();
        expect(install?.args).toContain('--ignore-scripts');
        // cwd is a mkdtemp consumer dir, never the repo root.
        expect(install?.cwd).not.toBe('/repo');
        expect(install?.cwd).toContain('chimera-verify-pack-');
    });

    it('stops and reports the failed step when packing fails, and still cleans up', async () => {
        const { run } = makeFakeRun((cmd, args) =>
            args[0] === 'pack' ? { status: 1, stdout: '', stderr: 'boom' } : undefined,
        );
        const { fs, removed } = makeFakeFs();

        const result = await verifyPack(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('pack');
        expect(removed.length).toBeGreaterThan(0);
    });

    it('fails when the renderer barrel probe fails (a missing exports/files entry)', async () => {
        const { run } = makeFakeRun((cmd, args) =>
            cmd === 'node' && args[0] === 'probe.mjs'
                ? { status: 1, stdout: '', stderr: 'Cannot find module' }
                : undefined,
        );
        const { fs, files } = makeFakeFs();
        seedInstalledRendererManifest(files);

        const result = await verifyPack(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('probe');
    });

    it('fails at the probe step when the packed exports map has a key no probe entry covers', async () => {
        const { run, calls } = makeFakeRun();
        const { fs, files, removed } = makeFakeFs();
        seedInstalledRendererManifest(files, { ...RENDERER_EXPORTS, './models': {} });
        const logs: string[] = [];

        const result = await verifyPack(makeDeps(run, fs, { log: (m) => logs.push(m) }));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('probe');
        // The gap report names the uncovered exports key.
        expect(logs.some((m) => m.includes('./models'))).toBe(true);
        // Completeness is checked before the resolution probe ever runs.
        expect(calls.some((c) => c.cmd === 'node' && c.args[0] === 'probe.mjs')).toBe(false);
        expect(removed.length).toBeGreaterThan(0);
    });

    it('fails at the probe step when the packed renderer manifest cannot be read', async () => {
        const { run } = makeFakeRun();
        const { fs } = makeFakeFs(); // nothing seeded → the installed manifest is absent

        const result = await verifyPack(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('probe');
    });

    it('fails at the probe step when the packed manifest carries no exports map at all', async () => {
        const { run } = makeFakeRun();
        const { fs, files } = makeFakeFs();
        files.set(
            installedRendererManifestPath(),
            JSON.stringify({ name: '@chimera-engine/renderer' }),
        );

        const result = await verifyPack(makeDeps(run, fs));

        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('probe');
    });
});

// ── verifyPackSelfTest (negative gate proof) ─────────────────────────────────

describe('verifyPackSelfTest', () => {
    it('passes only when the probe FAILS against a deliberately-broken packed surface', async () => {
        // Probe fails (status 1) → the gate correctly detected the dropped entry.
        const { run } = makeFakeRun((cmd, args) =>
            cmd === 'node' && args[0] === 'probe.mjs'
                ? { status: 1, stdout: '', stderr: 'Cannot find module' }
                : undefined,
        );
        const { fs } = makeFakeFs();

        const result = await verifyPackSelfTest(makeDeps(run, fs));

        expect(result.ok).toBe(true);
    });

    it('FAILS the self-test when the probe passes despite a dropped entry (gate not guarding)', async () => {
        // Every command (including the probe) succeeds → the broken surface slipped through.
        const { run } = makeFakeRun();
        const { fs } = makeFakeFs();

        const result = await verifyPackSelfTest(makeDeps(run, fs));

        expect(result.ok).toBe(false);
    });
});

// ── env contract ─────────────────────────────────────────────────────────────

describe('E2E_NODE_MODULES_ENV', () => {
    it('is the env var global-setup reads to flip esbuild resolution onto the tarballs', () => {
        expect(E2E_NODE_MODULES_ENV).toBe('CHIMERA_VERIFY_PACK_NODE_MODULES');
    });
});
