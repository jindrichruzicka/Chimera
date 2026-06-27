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
    renderToolchainModule,
    type ToolchainSnapshot,
} from './gen-toolchain';

describe('buildEngineRanges', () => {
    it('maps each engine package version to a caret range, ignoring non-engine entries', () => {
        const ranges = buildEngineRanges({
            '@chimera/simulation': '0.9.0',
            '@chimera/ai': '0.9.1',
            '@chimera/renderer': '1.2.3',
            // not an engine package — must be ignored
            '@chimera/tactics': '0.5.0',
        });
        expect(ranges['@chimera/simulation']).toBe('^0.9.0');
        expect(ranges['@chimera/ai']).toBe('^0.9.1');
        expect(ranges['@chimera/renderer']).toBe('^1.2.3');
        expect(ranges['@chimera/tactics']).toBeUndefined();
    });
});

describe('buildSnapshot', () => {
    it('strips @chimera/* from toolchain deps, carets the engine versions, and passes compilerOptions through', () => {
        const snapshot = buildSnapshot({
            rootPkg: {
                dependencies: { three: '^0.184', '@chimera/renderer': 'workspace:*' },
                devDependencies: { vitest: '^3', '@chimera/electron': 'workspace:*' },
            },
            engineVersions: { '@chimera/simulation': '0.9.0', '@chimera/electron': '0.9.0' },
            compilerOptions: { strict: true, target: 'ES2022' },
        });
        expect(snapshot.toolchainDeps).toEqual({ three: '^0.184', vitest: '^3' });
        expect(Object.keys(snapshot.toolchainDeps).some((k) => k.startsWith('@chimera/'))).toBe(
            false,
        );
        expect(snapshot.engineRanges['@chimera/simulation']).toBe('^0.9.0');
        expect(snapshot.compilerOptions).toEqual({ strict: true, target: 'ES2022' });
    });
});

describe('renderToolchainModule', () => {
    const snapshot: ToolchainSnapshot = {
        toolchainDeps: { vitest: '^3', next: '^15' },
        engineRanges: { '@chimera/simulation': '^0.9.0' },
        compilerOptions: { strict: true },
    };

    it('emits a DO-NOT-EDIT module exporting the three frozen constants', () => {
        const out = renderToolchainModule(snapshot);
        expect(out).toContain('DO NOT EDIT');
        expect(out).toContain('export const TOOLCHAIN_DEPS');
        expect(out).toContain('export const ENGINE_DEP_RANGES');
        expect(out).toContain('export const ROOT_COMPILER_OPTIONS');
        expect(out).toContain('"@chimera/simulation": "^0.9.0"');
    });

    it('is deterministic — keys are sorted so regeneration is stable', () => {
        // Same data in a different insertion order must render byte-identically.
        const reordered: ToolchainSnapshot = {
            toolchainDeps: { next: '^15', vitest: '^3' },
            engineRanges: { '@chimera/simulation': '^0.9.0' },
            compilerOptions: { strict: true },
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
            toolchainDeps: { next: '^15' },
            engineRanges: {},
            compilerOptions: {},
        });
        expect(checkSnapshotDrift(expected, expected)).toBe(false);
    });

    it('reports drift when the committed module is stale (an input changed)', () => {
        const committed = renderToolchainModule({
            toolchainDeps: { next: '^15' },
            engineRanges: {},
            compilerOptions: {},
        });
        const expected = renderToolchainModule({
            toolchainDeps: { next: '^16' }, // a bumped dep that was never regenerated
            engineRanges: {},
            compilerOptions: {},
        });
        expect(checkSnapshotDrift(committed, expected)).toBe(true);
    });
});
