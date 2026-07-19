// tools/gen-toolchain.test.ts
//
// Unit tests for the toolchain-snapshot generator (issue F66 follow-on). The generator freezes
// the monorepo's toolchain dep ranges, engine package version ranges, and root compilerOptions
// into tools/create-chimera-game/toolchain.generated.ts so the PUBLISHED create-chimera-game CLI
// can emit a standalone project with the exact versions the engine builds against — without
// reading the monorepo at `npm create` time. `verify:toolchain-snapshot` (the --check arm) fails
// when the committed snapshot drifts from the live inputs; these tests pin the pure core.

import { describe, expect, it } from 'vitest';
import {
    buildEngineRanges,
    buildSnapshot,
    checkSnapshotDrift,
    pinToolchainDeps,
    renderToolchainModule,
    type ToolchainSnapshot,
} from './gen-toolchain';
import { TOOLCHAIN_DEPS } from './create-chimera-game/toolchain.generated';

describe('buildEngineRanges', () => {
    it('maps each engine package version to a caret range, ignoring non-engine entries', () => {
        const ranges = buildEngineRanges({
            '@chimera-engine/simulation': '0.9.0',
            '@chimera-engine/ai': '0.9.1',
            '@chimera-engine/renderer': '1.2.3',
            // not an engine package — must be ignored
            '@chimera-engine/tactics': '0.5.0',
        });
        expect(ranges['@chimera-engine/simulation']).toBe('^0.9.0');
        expect(ranges['@chimera-engine/ai']).toBe('^0.9.1');
        expect(ranges['@chimera-engine/renderer']).toBe('^1.2.3');
        expect(ranges['@chimera-engine/tactics']).toBeUndefined();
    });
});

describe('pinToolchainDeps', () => {
    it('pins every toolchain range to the exact installed version', () => {
        const pinned = pinToolchainDeps(
            { next: '^15.5.15', react: '^19.2.5' },
            { next: '15.5.15', react: '19.2.5', unrelated: '1.0.0' },
        );
        expect(pinned).toEqual({ next: '15.5.15', react: '19.2.5' });
    });

    it('throws naming the dep when its installed version is unknown', () => {
        expect(() => pinToolchainDeps({ next: '^15.5.15' }, {})).toThrow(/next/);
    });
});

describe('buildSnapshot', () => {
    it('strips @chimera-engine/* from toolchain deps, pins them to installed versions, carets the engine versions, and passes compilerOptions + the pnpm/Node envelope through', () => {
        const snapshot = buildSnapshot({
            rootPkg: {
                dependencies: { three: '^0.184', '@chimera-engine/renderer': 'workspace:*' },
                devDependencies: { vitest: '^3', '@chimera-engine/electron': 'workspace:*' },
                packageManager: 'pnpm@10.33.0',
                engines: { node: '>=20.0.0' },
            },
            installedVersions: { three: '0.184.0', vitest: '3.2.4' },
            engineVersions: {
                '@chimera-engine/simulation': '0.9.0',
                '@chimera-engine/electron': '0.9.0',
            },
            compilerOptions: { strict: true, target: 'ES2022' },
        });
        expect(snapshot.toolchainDeps).toEqual({ three: '0.184.0', vitest: '3.2.4' });
        expect(
            Object.keys(snapshot.toolchainDeps).some((k) => k.startsWith('@chimera-engine/')),
        ).toBe(false);
        expect(snapshot.engineRanges['@chimera-engine/simulation']).toBe('^0.9.0');
        expect(snapshot.compilerOptions).toEqual({ strict: true, target: 'ES2022' });
        expect(snapshot.packageManager).toBe('pnpm@10.33.0');
        expect(snapshot.engines).toEqual({ node: '>=20.0.0' });
    });

    it('fails loudly when a toolchain dep has no installed version (never emits a floating range)', () => {
        expect(() =>
            buildSnapshot({
                rootPkg: {
                    devDependencies: { next: '^15.5.15' },
                    packageManager: 'pnpm@10.33.0',
                    engines: { node: '>=20.0.0' },
                },
                installedVersions: {},
                engineVersions: {},
                compilerOptions: {},
            }),
        ).toThrow(/next/);
    });

    it('fails loudly when the root pins no packageManager or engines (the scaffold must freeze the tested envelope)', () => {
        expect(() =>
            buildSnapshot({
                rootPkg: { devDependencies: {}, engines: { node: '>=20.0.0' } },
                installedVersions: {},
                engineVersions: {},
                compilerOptions: {},
            }),
        ).toThrow(/packageManager/);
        expect(() =>
            buildSnapshot({
                rootPkg: { devDependencies: {}, packageManager: 'pnpm@10.33.0' },
                installedVersions: {},
                engineVersions: {},
                compilerOptions: {},
            }),
        ).toThrow(/engines/);
    });
});

describe('committed toolchain snapshot', () => {
    it('pins every toolchain dep to an EXACT version — a range here re-opens toolchain drift for scaffolded projects (next@15.5.20 broke the static export)', () => {
        const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
        for (const [name, version] of Object.entries(TOOLCHAIN_DEPS)) {
            expect(version, `${name} must be an exact pin, got "${version}"`).toMatch(EXACT_SEMVER);
        }
    });
});

describe('renderToolchainModule', () => {
    const snapshot: ToolchainSnapshot = {
        toolchainDeps: { vitest: '^3', next: '^15' },
        engineRanges: { '@chimera-engine/simulation': '^0.9.0' },
        compilerOptions: { strict: true },
        packageManager: 'pnpm@10.33.0',
        engines: { node: '>=20.0.0' },
    };

    it('emits a DO-NOT-EDIT module exporting the five frozen constants', () => {
        const out = renderToolchainModule(snapshot);
        expect(out).toContain('DO NOT EDIT');
        expect(out).toContain('export const TOOLCHAIN_DEPS');
        expect(out).toContain('export const ENGINE_DEP_RANGES');
        expect(out).toContain('export const ROOT_COMPILER_OPTIONS');
        expect(out).toContain('export const ROOT_PACKAGE_MANAGER = "pnpm@10.33.0"');
        expect(out).toContain('export const ROOT_ENGINES');
        expect(out).toContain('"@chimera-engine/simulation": "^0.9.0"');
        expect(out).toContain('"node": ">=20.0.0"');
    });

    it('is deterministic — keys are sorted so regeneration is stable', () => {
        // Same data in a different insertion order must render byte-identically.
        const reordered: ToolchainSnapshot = {
            toolchainDeps: { next: '^15', vitest: '^3' },
            engineRanges: { '@chimera-engine/simulation': '^0.9.0' },
            compilerOptions: { strict: true },
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20.0.0' },
        };
        expect(renderToolchainModule(reordered)).toBe(renderToolchainModule(snapshot));
        // 'next' sorts before 'vitest' in the rendered output.
        expect(renderToolchainModule(snapshot).indexOf('"next"')).toBeLessThan(
            renderToolchainModule(snapshot).indexOf('"vitest"'),
        );
    });
});

describe('checkSnapshotDrift', () => {
    it('reports no drift when the committed module matches the freshly rendered one', () => {
        const expected = renderToolchainModule({
            toolchainDeps: { next: '15.5.15' },
            engineRanges: {},
            compilerOptions: {},
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20.0.0' },
        });
        expect(checkSnapshotDrift(expected, expected)).toBe(false);
    });

    it('reports drift when the committed module is stale (an input changed)', () => {
        const committed = renderToolchainModule({
            toolchainDeps: { next: '15.5.15' },
            engineRanges: {},
            compilerOptions: {},
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20.0.0' },
        });
        const expected = renderToolchainModule({
            toolchainDeps: { next: '15.5.16' }, // a bumped dep that was never regenerated
            engineRanges: {},
            compilerOptions: {},
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20.0.0' },
        });
        expect(checkSnapshotDrift(committed, expected)).toBe(true);
    });
});
