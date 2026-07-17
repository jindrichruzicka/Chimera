import { describe, expect, it } from 'vitest';
import {
    buildStandaloneRootManifest,
    buildStandaloneRootTsconfig,
    buildStandaloneToolchainDeps,
    buildStandaloneVitestConfig,
    buildStandaloneWorkspaceYaml,
    rewriteAppPackageForStandalone,
    rewriteAppTsconfigBuildForStandalone,
    rewriteE2eTsconfigForStandalone,
} from './standalone';

/**
 * Unit tests for the pure standalone-root synthesizers shared by the published
 * create-chimera-game CLI and the verify:scaffold gate. They assert the toolchain-deps
 * derivation, the root manifest shape in BOTH the npm-resolved (no overrides) and the
 * gate's tarball-resolved (overrides supplied) forms, the workspace yaml, and the
 * self-contained unit-arm vitest config.
 */

describe('buildStandaloneToolchainDeps', () => {
    it('merges root deps + devDeps and strips every @chimera-engine/* workspace entry', () => {
        const deps = buildStandaloneToolchainDeps({
            dependencies: { three: '^0.184', '@chimera-engine/renderer': 'workspace:*' },
            devDependencies: {
                vitest: '^3',
                '@chimera-engine/tactics': 'workspace:*',
                next: '^15',
            },
        });
        expect(deps).toEqual({ three: '^0.184', vitest: '^3', next: '^15' });
        expect(Object.keys(deps).some((k) => k.startsWith('@chimera-engine/'))).toBe(false);
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
        // No @chimera-engine/* leaks into the declared deps (the app declares them, resolved from npm).
        expect(
            Object.keys(manifest.devDependencies).some((k) => k.startsWith('@chimera-engine/')),
        ).toBe(false);
        // The published form has no pnpm.overrides — npm resolution, not tarballs.
        expect(manifest.pnpm.overrides).toBeUndefined();
        // electron + esbuild install scripts are allowed (e2e needs the binaries).
        expect(manifest.pnpm.onlyBuiltDependencies).toEqual(['electron', 'esbuild']);
        // sharp's script is intentionally ignored (unused prebuilt Next.js dep) so a fresh
        // install prints no "ignored build scripts" warning.
        expect(manifest.pnpm.ignoredBuiltDependencies).toEqual(['sharp']);
        // global-setup runs `pnpm build:packages` from this root: it must be a no-op (packages
        // arrive prebuilt), never the engine's real build.
        expect(manifest.scripts['build:packages']).toBeDefined();
        expect(manifest.scripts['build:packages']).not.toContain('tsc');
        // The standalone root carries the per-game packaging flow (the standalone twin of the
        // monorepo's `package:<game>`): build the renderer + app bundle, then electron-builder.
        // It omits `build:packages` (the engine arrives prebuilt) and drives the app by filter.
        expect(manifest.scripts['package']).toContain('next build apps/my-game/renderer');
        expect(manifest.scripts['package']).toContain('@chimera-engine/my-game build:app');
        expect(manifest.scripts['package']).toContain('@chimera-engine/my-game run package');
        expect(manifest.scripts['package']).not.toContain('build:packages');
    });

    it('carries the supplied pnpm.overrides for the gate tarball-resolved form', () => {
        const overrides = { '@chimera-engine/renderer': 'file:/tmp/chimera-renderer-0.9.0.tgz' };
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
        name: '@chimera-engine/my-game',
        dependencies: {
            '@chimera-engine/simulation': 'workspace:*',
            '@chimera-engine/renderer': 'workspace:*',
        },
        scripts: {
            'build:app': 'tsx electron/build-main.ts',
            'test:e2e': 'playwright test --config=e2e/playwright.config.ts --project=electron-e2e',
            test: 'vitest run --config ../../vitest.config.mts --dir .',
        },
    });

    it('rewrites @chimera-engine/* workspace deps onto their published ^ranges', () => {
        const out = JSON.parse(
            rewriteAppPackageForStandalone(raw, {
                engineRanges: {
                    '@chimera-engine/simulation': '^0.9.0',
                    '@chimera-engine/renderer': '^0.9.0',
                },
                nodeModulesEnv: 'node_modules',
            }),
        );
        expect(out.dependencies['@chimera-engine/simulation']).toBe('^0.9.0');
        expect(out.dependencies['@chimera-engine/renderer']).toBe('^0.9.0');
        expect(JSON.stringify(out)).not.toContain('workspace:*');
    });

    it('rewrites @chimera-engine/* workspace deps declared in devDependencies (#817 template shape)', () => {
        // The blank template declares the engine packages under devDependencies (they are
        // esbuild-inlined at build time and must stay out of electron-builder's prod tree).
        // A surviving `workspace:*` in any section makes a standalone `npm install` reject the
        // app, so the rewrite must reach devDependencies too.
        const devOnly = JSON.stringify({
            name: '@chimera-engine/my-game',
            devDependencies: {
                '@chimera-engine/simulation': 'workspace:*',
                '@chimera-engine/renderer': 'workspace:*',
                electron: '^33.2.0',
            },
        });
        const out = JSON.parse(
            rewriteAppPackageForStandalone(devOnly, {
                engineRanges: {
                    '@chimera-engine/simulation': '^0.9.0',
                    '@chimera-engine/renderer': '^0.9.0',
                },
                nodeModulesEnv: 'node_modules',
            }),
        );
        expect(out.devDependencies['@chimera-engine/simulation']).toBe('^0.9.0');
        expect(out.devDependencies['@chimera-engine/renderer']).toBe('^0.9.0');
        // Non-engine devDeps are untouched; no workspace:* spec survives in any section.
        expect(out.devDependencies.electron).toBe('^33.2.0');
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

describe('rewriteAppTsconfigBuildForStandalone', () => {
    // Mirrors the blank template's tsconfig.build.json: a leading comment block, the composite
    // compilerOptions, the monorepo-relative `references`, and an `exclude` after it.
    const raw = `{
    // Composite \`tsc -b\` build for this @chimera-engine/<game> consumer app.
    "extends": "../../tsconfig.json",
    "compilerOptions": {
        "composite": true,
        "outDir": "./dist"
    },
    "references": [
        { "path": "../../simulation/tsconfig.build.json" },
        { "path": "../../ai/tsconfig.build.json" },
        { "path": "../../renderer/tsconfig.build.json" },
        { "path": "../../electron/tsconfig.build.json" }
    ],
    "include": ["**/*.ts", "**/*.tsx"],
    "exclude": ["node_modules", "dist", "electron/**", "e2e/**"]
}
`;

    it('empties the monorepo references so tsc resolves the engine from node_modules', () => {
        const out = rewriteAppTsconfigBuildForStandalone(raw);
        // No monorepo-relative project references survive…
        expect(out).not.toContain('../../simulation/tsconfig.build.json');
        expect(out).not.toContain('../../electron/tsconfig.build.json');
        expect(out).not.toMatch(/"references":\s*\[\s*\{/);
        expect(out).toContain('"references": []');
    });

    it('preserves the surrounding compilerOptions, comments, include + exclude', () => {
        const out = rewriteAppTsconfigBuildForStandalone(raw);
        expect(out).toContain('// Composite `tsc -b` build');
        expect(out).toContain('"composite": true');
        expect(out).toContain('"outDir": "./dist"');
        expect(out).toContain('"include": ["**/*.ts", "**/*.tsx"]');
        expect(out).toContain('"exclude": ["node_modules", "dist", "electron/**", "e2e/**"]');
    });

    it('is idempotent — re-running leaves an already-emptied references untouched', () => {
        const once = rewriteAppTsconfigBuildForStandalone(raw);
        const twice = rewriteAppTsconfigBuildForStandalone(once);
        expect(twice).toBe(once);
    });
});

describe('rewriteE2eTsconfigForStandalone', () => {
    // Mirrors the blank template's e2e/tsconfig.json: a comment block, baseUrl, and the
    // monorepo-relative engine `paths` plus the standalone-valid game path (last, no comma).
    const raw = `{
    // Playwright-runner resolution shim ONLY.
    "extends": "../../../tsconfig.json",
    "compilerOptions": {
        "baseUrl": "../../..",
        "paths": {
            "@chimera-engine/simulation/*": ["simulation/dist/*"],
            "@chimera-engine/ai/*": ["ai/dist/*"],
            "@chimera-engine/networking": ["networking/dist/index.d.ts"],
            "@chimera-engine/networking/*": ["networking/dist/*"],
            "@chimera-engine/renderer/*": ["renderer/dist/*"],
            "@chimera-engine/electron/*": ["electron/dist/*"],
            "@chimera-engine/verify-scaffold-probe/*": ["apps/verify-scaffold-probe/*"]
        }
    }
}
`;

    it('drops the monorepo engine paths (the dist mappings)', () => {
        const out = rewriteE2eTsconfigForStandalone(raw);
        for (const pkg of ['simulation', 'ai', 'networking', 'renderer', 'electron']) {
            expect(out).not.toContain(`${pkg}/dist`);
        }
        // No monorepo `*/dist/*` path target survives.
        expect(out).not.toContain('dist/*');
    });

    it('keeps the standalone-valid game path + baseUrl + comments', () => {
        const out = rewriteE2eTsconfigForStandalone(raw);
        expect(out).toContain(
            '"@chimera-engine/verify-scaffold-probe/*": ["apps/verify-scaffold-probe/*"]',
        );
        expect(out).toContain('"baseUrl": "../../.."');
        expect(out).toContain('// Playwright-runner resolution shim');
        // The result must still parse as JSON once comments are stripped (no dangling comma).
        const stripped = out.replace(/^\s*\/\/.*$/gm, '');
        expect(() => JSON.parse(stripped) as unknown).not.toThrow();
    });

    it('is idempotent — re-running leaves the engine-stripped paths untouched', () => {
        const once = rewriteE2eTsconfigForStandalone(raw);
        const twice = rewriteE2eTsconfigForStandalone(once);
        expect(twice).toBe(once);
    });
});

describe('buildStandaloneVitestConfig', () => {
    it('aliases chimera-game-registration to the app register and resolves @chimera-engine via node_modules', () => {
        const config = buildStandaloneVitestConfig('my-game');
        expect(config).toContain('chimera-game-registration');
        expect(config).toContain('apps/my-game/renderer/register.ts');
        // The config must NOT pull @chimera-engine/* onto source — that is the reach-through the gate forbids.
        expect(config).not.toContain('createPreferTypeScriptSourceResolver');
        expect(config).not.toContain('@chimera-engine/renderer');
    });
});
