/**
 * tools/verify-packaged-bundle.test.ts
 *
 * Ratchets the THIN-DRIVER shape of the monorepo's `verify:packaged-bundle`
 * gate. The predicates, the marker set, and the self-validating orchestration
 * moved into the engine (`@chimera-engine/electron/packaged-bundle`) so the
 * monorepo and every scaffolded game verify the same property through ONE
 * definition; they are unit-tested there
 * (`electron/packaged-bundle/verify-packaged-bundle.test.ts`).
 *
 * What must hold HERE is the property the move exists for and the wiring the
 * engine cannot see:
 *
 *   - exactly one marker definition repo-wide — a second copy drifts silently
 *     and in one direction only (the weaker copy stops naming a module and its
 *     checks keep passing), which is the multi-copy failure mode that defeated
 *     several review rounds before the set was consolidated;
 *   - the driver drives the ENGINE helper at the app's own bundle plan and the
 *     real packaging invocation, and carries no predicate or marker copies of
 *     its own — a driver that regrew local checks would fork the definition
 *     with every assertion still green;
 *   - the root script still reaches this driver, because the CI and merge-gate
 *     pins (`ci-workflow.test.ts`, `merge-gate.test.ts`) hold `pnpm
 *     verify:packaged-bundle` and would not notice the script pointing at
 *     nothing.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const driverPath = path.join(workspaceRoot, 'tools/verify-packaged-bundle.ts');
const engineMarkersPath = 'electron/packaged-bundle/debug-bundle-markers.ts';

/** Build-output and dependency dirs — generated copies of the source are expected there. */
const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'out',
    '.next',
    '.git',
    '.e2e-build',
    '.dev-userdata',
    'release',
    'coverage',
]);

/** Every checked-in .ts/.tsx file under `dir`, workspace-relative. */
function walkTypeScriptSources(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
                files.push(...walkTypeScriptSources(path.join(dir, entry.name)));
            }
            continue;
        }
        if (/\.tsx?$/.test(entry.name)) {
            files.push(path.relative(workspaceRoot, path.join(dir, entry.name)));
        }
    }
    return files;
}

describe('verify:packaged-bundle thin driver (Invariant #27, single-definition contract)', () => {
    it('defines the debug-bundle marker set exactly once, in the engine package', () => {
        // Assembled from parts so this scanner's own source never matches itself.
        const definition = ['export', 'const', 'DEBUG_GRAPH_MARKERS'].join(' ');
        const definitions = walkTypeScriptSources(workspaceRoot).filter((file) =>
            readFileSync(path.join(workspaceRoot, file), 'utf8').includes(definition),
        );
        expect(definitions).toEqual([engineMarkersPath]);
    });

    it('has dropped the app-local marker copy the engine export replaced', () => {
        expect(
            existsSync(path.join(workspaceRoot, 'apps/tactics/electron/debug-bundle-markers.ts')),
        ).toBe(false);
    });

    it('drives the engine-exported helper instead of carrying its own checks', () => {
        const source = readFileSync(driverPath, 'utf8');
        expect(source).toContain("from '@chimera-engine/electron/packaged-bundle'");
        expect(source).toContain('verifyPackagedBundle(');
        // No local predicate or marker residue: any of these names in the driver
        // means checking logic grew back outside the single engine definition.
        for (const forked of ['SnapshotRingBuffer', 'chimera:debug', 'checkBundleText']) {
            expect(source, `driver must not carry a local copy of ${forked}`).not.toContain(forked);
        }
    });

    it('points the helper at the app bundle plan and the real packaging invocation', () => {
        const source = readFileSync(driverPath, 'utf8');
        // The gate tracks the plan, never restates it: the outfile map comes from
        // the app's own build-main, and the build is the same `--filter <app>
        // build:app` segment the packaging scripts run, keyed by the same env var.
        expect(source).toContain("from '../apps/tactics/electron/build-main.js'");
        expect(source).toContain('appBundleOutfiles(');
        expect(source).toContain("'build:app'");
        // The packaging env var arrives by IMPORT from the app's build plan, not
        // as a restated literal that could drift from what build-main reads.
        expect(source).toContain('PACKAGED_BUILD_ENV');
    });

    it('remains reachable from the pinned root script', () => {
        // ci-workflow.test.ts and merge-gate.test.ts pin `pnpm
        // verify:packaged-bundle`; this is the link from that name to this file.
        const rootPkg = JSON.parse(
            readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'),
        ) as { scripts?: Record<string, string> };
        expect(rootPkg.scripts?.['verify:packaged-bundle']).toBe(
            'tsx tools/verify-packaged-bundle.ts',
        );
    });
});
