/**
 * electron/__tests__/package-exports-contract.test.ts
 *
 * Locks the `@chimera-engine/electron` package surface declared in `package.json`
 * (issue #777 — F62 surface contract + dist build), mirroring the contract
 * tests of @chimera-engine/simulation (#759), @chimera-engine/networking (#768) and
 * @chimera-engine/renderer (#772/#773):
 *
 *   - the package is an ES module shipping the built `dist/` (Appendix C.3);
 *   - the public `exports` are the TWO entry points named by the issue — the
 *     main-process bootstrap (`./main`) and the preload bridge (`./preload/api`
 *     + the renderer-facing type contracts `./preload/api-types` and
 *     `./preload/debug-api-types`). Every export resolves to a `dist/` artifact;
 *   - there is NO broad `./*.js` wildcard and NO `.` barrel, so main-process
 *     internals (ipc/, managers, runtime/, the debug-api runtime preload) are
 *     built into dist but NOT reachable as package subpaths (Invariant #5,
 *     AC #3 — the preload bridge is the sole renderer-facing surface);
 *   - the preload TYPE contracts (`./preload/api-types`, `./preload/debug-api-types`)
 *     resolve `types` to SOURCE while `default` stays on dist. This is the #772-style
 *     bridge: renderer's chat barrel carries a tolerated type-only back-edge onto
 *     these contracts and is built BEFORE electron (electron references renderer),
 *     so their `.d.ts` does not yet exist when renderer compiles — reading the
 *     source as a node_modules external avoids both a build-order cycle and a
 *     rootDir violation. The full `types`→dist flip lands with the back-edge cleanup
 *     (later in F62). `./main` and `./preload/api` have no pre-electron consumer and
 *     resolve fully to dist;
 *   - the four engine packages (`@chimera-engine/simulation`, `@chimera-engine/ai`,
 *     `@chimera-engine/networking`, `@chimera-engine/renderer`) remain its only `@chimera-engine/*`
 *     dependencies; `@chimera-engine/tactics` is NOT a declared dependency — the
 *     game-injection seam in the composition registries is removed in T2.
 *
 * Reading the manifest directly guards the contract against drift.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ElectronManifest {
    type?: string;
    files?: string[];
    types?: string;
    main?: string;
    exports?: Record<string, { types?: string; default?: string } | string>;
    dependencies?: Record<string, string>;
}

const manifest = JSON.parse(
    readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
) as ElectronManifest;

const EXPECTED_EXPORTS = {
    './main': {
        types: './dist/main/index.d.ts',
        default: './dist/main/index.js',
    },
    './preload/api': {
        types: './dist/preload/api.d.ts',
        default: './dist/preload/api.js',
    },
    // Type-only preload contracts: `types`→source bridge (#772-style), `default`→dist.
    './preload/api-types': {
        types: './preload/api-types.ts',
        default: './dist/preload/api-types.js',
    },
    './preload/api-types.js': {
        types: './preload/api-types.ts',
        default: './dist/preload/api-types.js',
    },
    './preload/debug-api-types': {
        types: './preload/debug-api-types.ts',
        default: './dist/preload/debug-api-types.js',
    },
    './preload/debug-api-types.js': {
        types: './preload/debug-api-types.ts',
        default: './dist/preload/debug-api-types.js',
    },
} as const;

describe('@chimera-engine/electron package surface (issue #777)', () => {
    it('is an ES module shipping the dist/ build', () => {
        expect(manifest.type).toBe('module');
        expect(manifest.files).toContain('dist');
        // No top-level `types`/`.` barrel — electron has no root index; the
        // public entry points are the curated subpaths below.
        expect(manifest.types).toBeUndefined();
    });

    it('exposes the main bootstrap + preload bridge entry points, all pointing at dist/', () => {
        const exportsMap = manifest.exports ?? {};
        expect(Object.keys(exportsMap).sort()).toEqual(Object.keys(EXPECTED_EXPORTS).sort());
        for (const [key, value] of Object.entries(EXPECTED_EXPORTS)) {
            expect(exportsMap[key]).toEqual(value);
        }
    });

    it('does not leak main-process internals — no `.` barrel and no broad wildcard subpath (Invariant #5)', () => {
        const exportsMap = manifest.exports ?? {};
        // No catch-all `.` barrel (main + preload are process-specific surfaces).
        expect(exportsMap['.']).toBeUndefined();
        // No broad `./*` / `./*.js` wildcard — a wildcard would expose every
        // dist file (ipc handlers, managers, runtime) as a package subpath.
        for (const key of Object.keys(exportsMap)) {
            expect(key.includes('*')).toBe(false);
        }
        // Every runtime (`default`) target ships from dist/; `types` targets are
        // either dist/ or the in-tree preload source (the #772-style bridge for the
        // preload type contracts consumed by the renderer back-edge before electron
        // builds). Nothing escapes the package into a sibling or node_modules.
        for (const value of Object.values(exportsMap)) {
            const entry = typeof value === 'string' ? { default: value } : value;
            if (entry.default !== undefined) {
                expect(entry.default.startsWith('./dist/')).toBe(true);
            }
            if (entry.types !== undefined) {
                expect(
                    entry.types.startsWith('./dist/') || entry.types.startsWith('./preload/'),
                ).toBe(true);
            }
        }
    });

    it('depends on the four engine packages only — not @chimera-engine/tactics', () => {
        const deps = manifest.dependencies ?? {};
        const chimeraDeps = Object.keys(deps)
            .filter((name) => name.startsWith('@chimera-engine/'))
            .sort();
        expect(chimeraDeps).toEqual([
            '@chimera-engine/ai',
            '@chimera-engine/networking',
            '@chimera-engine/renderer',
            '@chimera-engine/simulation',
        ]);
        for (const dep of chimeraDeps) {
            expect(deps[dep]).toBe('workspace:*');
        }
        // The game-injection seam in the composition registries is removed in
        // T2; tactics must never become a declared dependency of the package.
        expect(deps['@chimera-engine/tactics']).toBeUndefined();
    });
});
