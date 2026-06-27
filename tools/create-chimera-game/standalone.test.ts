import { describe, expect, it } from 'vitest';
import {
    buildStandaloneRootManifest,
    buildStandaloneRootTsconfig,
    buildStandaloneToolchainDeps,
    buildStandaloneVitestConfig,
    buildStandaloneWorkspaceYaml,
    rewriteAppPackageForStandalone,
} from './standalone';

/**
 * Unit tests for the pure standalone-root synthesizers shared by the published
 * create-chimera-game CLI and the verify:scaffold gate. They assert the toolchain-deps
 * derivation, the root manifest shape in BOTH the npm-resolved (no overrides) and the
 * gate's tarball-resolved (overrides supplied) forms, the workspace yaml, and the
 * self-contained unit-arm vitest config.
 */

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

describe('buildStandaloneRootManifest', () => {
    it('declares the toolchain, stubs build:packages, and emits NO overrides for the npm-resolved form', () => {
        const manifest = buildStandaloneRootManifest({
            name: 'my-game',
            toolchainDeps: { next: '^15', electron: '^33' },
        });
        expect(manifest.private).toBe(true);
        expect(manifest.name).toBe('my-game');
        expect(manifest.devDependencies['next']).toBe('^15');
        // No @chimera/* leaks into the declared deps (the app declares them, resolved from npm).
        expect(Object.keys(manifest.devDependencies).some((k) => k.startsWith('@chimera/'))).toBe(
            false,
        );
        // The published form has no pnpm.overrides — npm resolution, not tarballs.
        expect(manifest.pnpm.overrides).toBeUndefined();
        // electron + esbuild install scripts are allowed (e2e needs the binaries).
        expect(manifest.pnpm.onlyBuiltDependencies).toEqual(['electron', 'esbuild']);
        // global-setup runs `pnpm build:packages` from this root: it must be a no-op (packages
        // arrive prebuilt), never the engine's real build.
        expect(manifest.scripts['build:packages']).toBeDefined();
        expect(manifest.scripts['build:packages']).not.toContain('tsc');
    });

    it('carries the supplied pnpm.overrides for the gate tarball-resolved form', () => {
        const overrides = { '@chimera/renderer': 'file:/tmp/chimera-renderer-0.9.0.tgz' };
        const manifest = buildStandaloneRootManifest({
            name: 'chimera-verify-scaffold-root',
            toolchainDeps: { next: '^15' },
            overrides,
        });
        expect(manifest.pnpm.overrides).toEqual(overrides);
        // overrides is a copy, not the caller's object.
        expect(manifest.pnpm.overrides).not.toBe(overrides);
    });
});

describe('buildStandaloneWorkspaceYaml', () => {
    it('declares apps/* as the sole workspace member', () => {
        expect(buildStandaloneWorkspaceYaml()).toBe('packages:\n  - apps/*\n');
    });
});

describe('buildStandaloneRootTsconfig', () => {
    it('emits a tsconfig.json wrapping the frozen compilerOptions for the app to extend', () => {
        const out = buildStandaloneRootTsconfig({ strict: true, target: 'ES2022' });
        const parsed = JSON.parse(out) as { compilerOptions: Record<string, unknown> };
        expect(parsed.compilerOptions).toEqual({ strict: true, target: 'ES2022' });
        // Plain JSON (no comments) so the app's `extends` chain + any parser can read it.
        expect(out).not.toContain('//');
    });
});

describe('rewriteAppPackageForStandalone', () => {
    const raw = JSON.stringify({
        name: '@chimera/my-game',
        dependencies: {
            '@chimera/simulation': 'workspace:*',
            '@chimera/renderer': 'workspace:*',
        },
        scripts: {
            'build:app': 'tsx electron/build-main.ts',
            'test:e2e': 'playwright test --config=e2e/playwright.config.ts --project=electron-e2e',
            test: 'vitest run --config ../../vitest.config.mts --dir .',
        },
    });

    it('rewrites @chimera/* workspace deps onto their published ^ranges', () => {
        const out = JSON.parse(
            rewriteAppPackageForStandalone(raw, {
                engineRanges: { '@chimera/simulation': '^0.9.0', '@chimera/renderer': '^0.9.0' },
                nodeModulesEnv: 'node_modules',
            }),
        );
        expect(out.dependencies['@chimera/simulation']).toBe('^0.9.0');
        expect(out.dependencies['@chimera/renderer']).toBe('^0.9.0');
        expect(JSON.stringify(out)).not.toContain('workspace:*');
    });

    it('injects CHIMERA_VERIFY_PACK_NODE_MODULES into build:app + test:e2e only, leaving test untouched', () => {
        const out = JSON.parse(
            rewriteAppPackageForStandalone(raw, {
                engineRanges: {},
                nodeModulesEnv: 'node_modules',
            }),
        );
        expect(out.scripts['build:app']).toBe(
            'cross-env CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules tsx electron/build-main.ts',
        );
        expect(out.scripts['test:e2e']).toContain(
            'cross-env CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules playwright test',
        );
        // The unit `test` script does not bundle Electron, so it is left alone.
        expect(out.scripts.test).toBe('vitest run --config ../../vitest.config.mts --dir .');
    });

    it('is idempotent — re-running does not double-inject the env', () => {
        const once = rewriteAppPackageForStandalone(raw, {
            engineRanges: {},
            nodeModulesEnv: 'node_modules',
        });
        const twice = rewriteAppPackageForStandalone(once, {
            engineRanges: {},
            nodeModulesEnv: 'node_modules',
        });
        expect(twice).toBe(once);
    });
});

describe('buildStandaloneVitestConfig', () => {
    it('aliases chimera-game-registration to the app register and resolves @chimera via node_modules', () => {
        const config = buildStandaloneVitestConfig('my-game');
        expect(config).toContain('chimera-game-registration');
        expect(config).toContain('apps/my-game/renderer/register.ts');
        // The config must NOT pull @chimera/* onto source — that is the reach-through the gate forbids.
        expect(config).not.toContain('createPreferTypeScriptSourceResolver');
        expect(config).not.toContain('@chimera/renderer');
    });
});
