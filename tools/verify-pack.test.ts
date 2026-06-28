// tools/verify-pack.test.ts
//
// Unit tests for the `verify:pack` true-artifact release gate (issue #794, F64 T2).
//
// Exercises the pure wiring — package list, pack argv + tarball-path parsing, the
// throwaway consumer manifest (file: deps + overrides, no workspace:* leak), the
// renderer-barrel resolution probe script, the scoped Playwright invocation, and
// the verifyPack / verifyPackSelfTest orchestration — with injected fakes, so no
// real pnpm, npm, playwright, electron, or filesystem is touched.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
    CHIMERA_PACKAGES,
    RENDERER_PEERS,
    E2E_NODE_MODULES_ENV,
    parsePackTarballPath,
    readPeerVersions,
    buildConsumerManifest,
    buildProbeScript,
    e2ePlaywrightArgs,
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

    it('asserts the renderer CSS subpath ships via files', () => {
        expect(buildProbeScript()).toContain('@chimera-engine/renderer/styles/tokens.css');
    });

    it('asserts the electron public surface (main + preload api) resolves from the tarball', () => {
        const script = buildProbeScript();
        expect(script).toContain('@chimera-engine/electron/main');
        expect(script).toContain('@chimera-engine/electron/preload/api');
    });

    it('is resolution-based (createRequire / require.resolve), not a runtime render', () => {
        const script = buildProbeScript();
        expect(script).toContain('createRequire');
        expect(script).toContain('require.resolve');
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
        const { fs, removed } = makeFakeFs();

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
        const { fs } = makeFakeFs();

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
        const { fs } = makeFakeFs();

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
