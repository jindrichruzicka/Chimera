// tools/verify-publish.test.ts
//
// Unit tests for the `verify:publish` publish-readiness gate (issue #804, F66).
//
// Exercises the pure wiring — external-specifier extraction (via the TypeScript
// pre-processor), specifier→package-name normalization, the node-builtin filter,
// the declared-dependency allowlist, the centerpiece undeclared-dep scan, and the
// verifyPublish / verifyPublishSelfTest orchestration — with injected fakes, so no
// real pnpm, publint, npm, or filesystem is touched.

import { describe, it, expect } from 'vitest';
import {
    CHIMERA_PACKAGES,
    specifierToPackageName,
    isNodeBuiltin,
    extractImportSpecifiers,
    buildAllowlist,
    findUndeclaredDeps,
    checkAllDeps,
    publintArgs,
    publishDryRunArgs,
    prereleaseDistTag,
    verifyPublish,
    verifyPublishSelfTest,
    CONSUMER_PROVIDED_SPECIFIERS,
    type RunFn,
    type RunResult,
    type ListPublishedJsFiles,
    type PackageManifest,
    type VerifyPublishDeps,
} from './verify-publish.js';

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface RecordedCall {
    cmd: string;
    args: readonly string[];
    cwd?: string | undefined;
}

/** A programmable RunFn; every command succeeds unless an override forces a failure. */
function makeFakeRun(
    overrides: (cmd: string, args: readonly string[]) => RunResult | undefined = () => undefined,
): { run: RunFn; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const run: RunFn = (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts?.cwd });
        return overrides(cmd, args) ?? { status: 0, stdout: '', stderr: '' };
    };
    return { run, calls };
}

/** An in-memory readFile + published-file walk backed by a `{ absPath -> source }` map. */
function makeFakeFsDeps(files: Record<string, string>): {
    fs: { readFile: (file: string) => Promise<string> };
    listPublishedJsFiles: ListPublishedJsFiles;
} {
    return {
        fs: {
            readFile: (file) => {
                const data = files[file];
                if (data === undefined) return Promise.reject(new Error(`ENOENT: ${file}`));
                return Promise.resolve(data);
            },
        },
        listPublishedJsFiles: (pkgDir) =>
            Promise.resolve(
                Object.keys(files).filter((f) => f.startsWith(`${pkgDir}/`) && f.endsWith('.js')),
            ),
    };
}

function makeDeps(
    run: RunFn,
    fsDeps: Pick<VerifyPublishDeps, 'fs' | 'listPublishedJsFiles'>,
    extra: Partial<VerifyPublishDeps> = {},
): VerifyPublishDeps {
    return {
        run,
        fs: fsDeps.fs,
        listPublishedJsFiles: fsDeps.listPublishedJsFiles,
        log: () => {},
        repoRoot: '/repo',
        ...extra,
    };
}

const RENDERER_MANIFEST: PackageManifest = {
    name: '@chimera-engine/renderer',
    peerDependencies: {
        react: '^19',
        'react-dom': '^19',
        three: '>=0.184',
        '@react-three/fiber': '^9',
        next: '^15',
    },
    dependencies: { '@chimera-engine/simulation': 'workspace:*', zustand: '^5' },
};

// ── Package list ──────────────────────────────────────────────────────────────

describe('CHIMERA_PACKAGES (re-exported)', () => {
    it('covers the five engine packages the gate scans', () => {
        expect(CHIMERA_PACKAGES.map((p) => p.name)).toEqual([
            '@chimera-engine/simulation',
            '@chimera-engine/ai',
            '@chimera-engine/networking',
            '@chimera-engine/renderer',
            '@chimera-engine/electron',
        ]);
    });
});

// ── extractImportSpecifiers ──────────────────────────────────────────────────

describe('extractImportSpecifiers', () => {
    it('catches import-from, export-from, side-effect, dynamic import, and require specifiers', () => {
        const src = [
            "import { a } from 'zod';",
            "export { b } from './relative.js';",
            "import 'react/jsx-runtime';",
            "const m = await import('three/examples/jsm/x.js');",
            "const ws = require('ws');",
        ].join('\n');
        expect(extractImportSpecifiers(src)).toEqual([
            'zod',
            './relative.js',
            'react/jsx-runtime',
            'three/examples/jsm/x.js',
            'ws',
        ]);
    });

    it('ignores specifiers that appear only inside comments (TS pre-processor strips them)', () => {
        const src = [
            '// import { x } from "@chimera-engine/core";',
            '/* import { y } from "totally-fake"; */',
            "import { real } from 'zod';",
        ].join('\n');
        expect(extractImportSpecifiers(src)).toEqual(['zod']);
    });

    it('returns nothing for a module with no imports (e.g. a type-only source erased to runtime)', () => {
        expect(extractImportSpecifiers('export const VERSION = 1;\n')).toEqual([]);
    });
});

// ── specifierToPackageName ───────────────────────────────────────────────────

describe('specifierToPackageName', () => {
    it('strips subpaths and preserves the scope for scoped packages', () => {
        expect(specifierToPackageName('@chimera-engine/simulation/engine/types.js')).toBe(
            '@chimera-engine/simulation',
        );
        expect(specifierToPackageName('@react-three/fiber')).toBe('@react-three/fiber');
    });

    it('strips subpaths for unscoped packages', () => {
        expect(specifierToPackageName('three/examples/jsm/loaders/GLTFLoader.js')).toBe('three');
        expect(specifierToPackageName('next/image')).toBe('next');
        expect(specifierToPackageName('react/jsx-runtime')).toBe('react');
        expect(specifierToPackageName('zod')).toBe('zod');
    });
});

// ── isNodeBuiltin ─────────────────────────────────────────────────────────────

describe('isNodeBuiltin', () => {
    it('recognizes bare, node:-prefixed, and subpath builtins', () => {
        expect(isNodeBuiltin('fs')).toBe(true);
        expect(isNodeBuiltin('node:fs')).toBe(true);
        expect(isNodeBuiltin('fs/promises')).toBe(true);
        expect(isNodeBuiltin('path')).toBe(true);
    });

    it('rejects real external packages', () => {
        expect(isNodeBuiltin('zod')).toBe(false);
        expect(isNodeBuiltin('@chimera-engine/simulation')).toBe(false);
    });
});

// ── buildAllowlist ────────────────────────────────────────────────────────────

describe('buildAllowlist', () => {
    it('unions dependencies, peerDependencies, optionalDependencies, and the package own name', () => {
        const allow = buildAllowlist(RENDERER_MANIFEST);
        for (const name of [
            '@chimera-engine/renderer',
            'react',
            'react-dom',
            'three',
            '@react-three/fiber',
            'next',
            '@chimera-engine/simulation',
            'zustand',
        ]) {
            expect(allow.has(name)).toBe(true);
        }
        expect(allow.has('vitest')).toBe(false);
    });
});

// ── findUndeclaredDeps (the centerpiece) ─────────────────────────────────────

describe('findUndeclaredDeps', () => {
    it('returns no findings when every external import is a declared dep/peer', () => {
        const files = new Map<string, string>([
            [
                '/repo/renderer/dist/scene.js',
                [
                    "import { useFrame } from '@react-three/fiber';",
                    "import * as THREE from 'three';",
                    "import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';",
                    "import { jsx } from 'react/jsx-runtime';",
                    "import { create } from 'zustand';",
                    "import type { GameSnapshot } from '@chimera-engine/simulation/contracts';",
                    "import { local } from './local.js';",
                    "import { readFile } from 'node:fs/promises';",
                ].join('\n'),
            ],
        ]);
        expect(findUndeclaredDeps(RENDERER_MANIFEST, files)).toEqual([]);
    });

    it('flags a stray runtime import not present in the manifest (the vitest-in-dist class)', () => {
        const manifest: PackageManifest = {
            name: '@chimera-engine/simulation',
            dependencies: { zod: '^4.3.6' },
        };
        const files = new Map<string, string>([
            [
                '/repo/simulation/dist/persistence/__test-support__/contractTests.js',
                "import { describe, expect, it } from 'vitest';\nimport { z } from 'zod';\n",
            ],
        ]);
        const findings = findUndeclaredDeps(manifest, files);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            pkg: '@chimera-engine/simulation',
            specifier: 'vitest',
            file: '/repo/simulation/dist/persistence/__test-support__/contractTests.js',
        });
    });

    it('flags a consumer-provided virtual seam by default but skips it when allowed', () => {
        const manifest: PackageManifest = {
            name: '@chimera-engine/renderer',
            dependencies: { '@chimera-engine/simulation': 'workspace:*' },
        };
        const files = new Map<string, string>([
            [
                '/repo/renderer/dist/app/GameRegistrationBootstrap.js',
                "import { registerGame } from 'chimera-game-registration';\n",
            ],
        ]);
        // Without the allowlist the seam reads as an undeclared dep…
        expect(findUndeclaredDeps(manifest, files)).toHaveLength(1);
        // …but it is intentionally consumer-resolved, so the gate allows it.
        expect(findUndeclaredDeps(manifest, files, CONSUMER_PROVIDED_SPECIFIERS)).toEqual([]);
    });

    it('does not flag specifiers that appear only in comments', () => {
        const manifest: PackageManifest = {
            name: '@chimera-engine/electron',
            dependencies: { pino: '^10', zod: '^4' },
        };
        const files = new Map<string, string>([
            [
                '/repo/electron/dist/preload/extensions-api.js',
                [
                    '// import { registerExtension } from "@chimera-engine/core/preload/extensions-api.js";',
                    "import pino from 'pino';",
                ].join('\n'),
            ],
        ]);
        expect(findUndeclaredDeps(manifest, files)).toEqual([]);
    });
});

// ── publint / dry-run argv ───────────────────────────────────────────────────

describe('publintArgs / publishDryRunArgs', () => {
    it('lints the package dir in strict mode', () => {
        expect(publintArgs('simulation')).toEqual([
            'exec',
            'publint',
            'run',
            'simulation',
            '--strict',
        ]);
    });

    it('dry-run-publishes without git checks (run from the package dir)', () => {
        expect(publishDryRunArgs()).toEqual(['publish', '--dry-run', '--no-git-checks']);
    });

    it('appends --tag for a prerelease dist-tag; omits it for a plain release', () => {
        expect(publishDryRunArgs('rc')).toEqual([
            'publish',
            '--dry-run',
            '--no-git-checks',
            '--tag',
            'rc',
        ]);
        expect(publishDryRunArgs(null)).toEqual(['publish', '--dry-run', '--no-git-checks']);
        expect(publishDryRunArgs('')).toEqual(['publish', '--dry-run', '--no-git-checks']);
    });
});

describe('prereleaseDistTag', () => {
    it('returns the first prerelease identifier (matches Changesets pre-mode tagging)', () => {
        expect(prereleaseDistTag('1.0.0-rc.0')).toBe('rc');
        expect(prereleaseDistTag('1.2.0-rc.3')).toBe('rc');
        expect(prereleaseDistTag('2.0.0-beta.1')).toBe('beta');
    });

    it('returns null for a plain release (npm default latest)', () => {
        expect(prereleaseDistTag('1.0.0')).toBeNull();
        expect(prereleaseDistTag('0.9.1')).toBeNull();
    });
});

// ── checkAllDeps ──────────────────────────────────────────────────────────────

describe('checkAllDeps', () => {
    it('reads each package manifest + dist and aggregates undeclared findings', async () => {
        const files: Record<string, string> = {
            '/repo/simulation/package.json': JSON.stringify({
                name: '@chimera-engine/simulation',
                dependencies: { zod: '^4.3.6' },
            }),
            '/repo/simulation/dist/index.js': "import { z } from 'zod';\n",
            // ai/networking/renderer/electron manifests with a single clean dist file each
            '/repo/ai/package.json': JSON.stringify({
                name: '@chimera-engine/ai',
                dependencies: { '@chimera-engine/simulation': 'workspace:*' },
            }),
            '/repo/ai/dist/index.js': "import { x } from '@chimera-engine/simulation/engine';\n",
            '/repo/networking/package.json': JSON.stringify({
                name: '@chimera-engine/networking',
                dependencies: { '@chimera-engine/simulation': 'workspace:*', ws: '^8' },
            }),
            '/repo/networking/dist/index.js': "import { WebSocket } from 'ws';\n",
            '/repo/renderer/package.json': JSON.stringify({
                name: '@chimera-engine/renderer',
                dependencies: { '@chimera-engine/simulation': 'workspace:*' },
            }),
            '/repo/renderer/dist/index.js': "import { x } from '@chimera-engine/simulation';\n",
            '/repo/electron/package.json': JSON.stringify({
                name: '@chimera-engine/electron',
                peerDependencies: { electron: '^33' },
                // intentionally omits 'pino' so the scan flags it
                dependencies: { zod: '^4' },
            }),
            '/repo/electron/dist/main/logger.js':
                "import pino from 'pino';\nimport { app } from 'electron';\n",
        };
        const { run } = makeFakeRun();
        const deps = makeDeps(run, makeFakeFsDeps(files));
        const findings = await checkAllDeps(deps);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ pkg: '@chimera-engine/electron', specifier: 'pino' });
    });
});

// ── verifyPublish orchestration ──────────────────────────────────────────────

/** A clean five-package fixture: every dist import is declared, so depcheck passes. */
function cleanRepoFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    for (const pkg of CHIMERA_PACKAGES) {
        files[`/repo/${pkg.dir}/package.json`] = JSON.stringify({ name: pkg.name });
        files[`/repo/${pkg.dir}/dist/index.js`] = "import { x } from 'node:path';\nexport {};\n";
    }
    return files;
}

describe('verifyPublish', () => {
    it('runs build → depcheck → publint → dry-run and returns ok when all pass', async () => {
        const { run, calls } = makeFakeRun();
        const deps = makeDeps(run, makeFakeFsDeps(cleanRepoFiles()));
        const result = await verifyPublish(deps);
        expect(result.ok).toBe(true);

        const cmds = calls.map((c) => `${c.cmd} ${c.args.join(' ')}`);
        expect(cmds[0]).toBe('pnpm build:packages');
        expect(cmds).toContain('pnpm exec publint run simulation --strict');
        expect(cmds).toContain('pnpm publish --dry-run --no-git-checks');
        // build precedes the first publint, which precedes the first dry-run
        const firstPublint = cmds.findIndex((c) => c.includes('publint'));
        const firstDryRun = cmds.findIndex((c) => c.includes('publish --dry-run'));
        expect(firstPublint).toBeGreaterThan(0);
        expect(firstDryRun).toBeGreaterThan(firstPublint);
    });

    it('fails at depcheck (before publint) when a dist imports an undeclared dep', async () => {
        const files = cleanRepoFiles();
        files['/repo/simulation/dist/index.js'] = "import { it } from 'vitest';\n";
        const { run, calls } = makeFakeRun();
        const deps = makeDeps(run, makeFakeFsDeps(files));
        const result = await verifyPublish(deps);
        expect(result.ok).toBe(false);
        expect(result.failedStep).toBe('depcheck');
        expect(result.undeclared?.[0]).toMatchObject({ specifier: 'vitest' });
        expect(calls.some((c) => c.args.includes('publint'))).toBe(false);
    });

    it('fails at build when build:packages exits non-zero', async () => {
        const { run } = makeFakeRun((cmd, args) =>
            args[0] === 'build:packages' ? { status: 1, stdout: '', stderr: 'boom' } : undefined,
        );
        const deps = makeDeps(run, makeFakeFsDeps(cleanRepoFiles()));
        const result = await verifyPublish(deps);
        expect(result).toMatchObject({ ok: false, failedStep: 'build' });
    });

    it('fails at publint when a package fails the lint', async () => {
        const { run } = makeFakeRun((cmd, args) =>
            args.includes('publint') ? { status: 1, stdout: '', stderr: 'lint error' } : undefined,
        );
        const deps = makeDeps(run, makeFakeFsDeps(cleanRepoFiles()));
        const result = await verifyPublish(deps);
        expect(result).toMatchObject({ ok: false, failedStep: 'publint' });
    });

    it('fails at dry-run when a package fails the publish dry-run', async () => {
        const { run } = makeFakeRun((cmd, args) =>
            args[0] === 'publish' ? { status: 1, stdout: '', stderr: 'publish error' } : undefined,
        );
        const deps = makeDeps(run, makeFakeFsDeps(cleanRepoFiles()));
        const result = await verifyPublish(deps);
        expect(result).toMatchObject({ ok: false, failedStep: 'dry-run' });
    });

    it('skips publint and dry-run when disabled via options', async () => {
        const { run, calls } = makeFakeRun();
        const deps = makeDeps(run, makeFakeFsDeps(cleanRepoFiles()));
        const result = await verifyPublish(deps, { skipPublint: true, dryRun: false });
        expect(result.ok).toBe(true);
        expect(calls.some((c) => c.args.includes('publint'))).toBe(false);
        expect(calls.some((c) => c.args[0] === 'publish')).toBe(false);
    });
});

// ── verifyPublishSelfTest (the negative gate) ────────────────────────────────

describe('verifyPublishSelfTest', () => {
    it('passes only because the depcheck detects a deliberately undeclared import', async () => {
        const { run } = makeFakeRun();
        const deps = makeDeps(run, makeFakeFsDeps({}));
        const result = await verifyPublishSelfTest(deps);
        expect(result.ok).toBe(true);
    });
});
