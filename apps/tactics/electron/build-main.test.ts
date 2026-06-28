import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    VERIFY_PACK_NODE_MODULES_ENV,
    computeNodePaths,
    computeEsbuildAlias,
    appBundleOutfiles,
    planBundles,
    buildAppBundles,
    type BuildFn,
    type BundleSpec,
} from './build-main.js';

/**
 * apps/tactics/electron/build-main.test.ts
 *
 * Unit guard for the app-owned Electron bundler (Seam 1, F65). The bundler is
 * self-contained inside the app (no `tools/` import) so it travels with the
 * scaffolding template. These tests exercise the PURE config derivation —
 * alias map, output paths, and the bundle plan — with esbuild + disk injected,
 * so the suite spawns nothing and touches no real files.
 */

const ROOT = '/repo';
const APP_DIR = path.join(ROOT, 'apps/tactics');
const GAME_PKG = '@chimera-engine/tactics';

describe('computeNodePaths', () => {
    it('is empty when the verify:pack env var is unset (everyday workspace resolution)', () => {
        expect(computeNodePaths({})).toEqual([]);
    });

    it('returns the throwaway node_modules when verify:pack mode is active', () => {
        const nm = '/tmp/consumer/node_modules';
        expect(computeNodePaths({ [VERIFY_PACK_NODE_MODULES_ENV]: nm })).toEqual([nm]);
    });

    it('ignores an empty-string env value', () => {
        expect(computeNodePaths({ [VERIFY_PACK_NODE_MODULES_ENV]: '' })).toEqual([]);
    });
});

describe('computeEsbuildAlias', () => {
    const opts = { root: ROOT, appDir: APP_DIR, gamePackageName: GAME_PKG };

    it("aliases the app's own @chimera-engine/<game> package onto its source dir", () => {
        const alias = computeEsbuildAlias({}, opts);
        expect(alias[GAME_PKG]).toBe(APP_DIR);
    });

    it('derives the game alias key from the package name, not a hardcoded literal', () => {
        const alias = computeEsbuildAlias(
            {},
            { ...opts, gamePackageName: '@chimera-engine/chess' },
        );
        expect(alias['@chimera-engine/chess']).toBe(APP_DIR);
        expect(alias[GAME_PKG]).toBeUndefined();
    });

    it('aliases @chimera-engine/electron/main onto host SOURCE in the everyday suite', () => {
        const alias = computeEsbuildAlias({}, opts);
        expect(alias['@chimera-engine/electron/main']).toBe(
            path.join(ROOT, 'electron/main/index.ts'),
        );
    });

    it('DROPS the @chimera-engine/electron/main source alias in verify:pack mode (resolve from tarball)', () => {
        const alias = computeEsbuildAlias(
            { [VERIFY_PACK_NODE_MODULES_ENV]: '/tmp/consumer/node_modules' },
            opts,
        );
        expect(alias['@chimera-engine/electron/main']).toBeUndefined();
        // The game alias still resolves to the consumer app source (it is the game,
        // not a packed engine artifact).
        expect(alias[GAME_PKG]).toBe(APP_DIR);
    });
});

describe('appBundleOutfiles', () => {
    it('emits main + preload + debug-preload under the app dist, matching package.json "main"', () => {
        const out = appBundleOutfiles(APP_DIR);
        expect(out.main).toBe(path.join(APP_DIR, 'dist/electron/main.js'));
        expect(out.preload).toBe(path.join(APP_DIR, 'dist/preload/api.js'));
        expect(out.debugPreload).toBe(path.join(APP_DIR, 'dist/preload/debug-api.js'));
    });
});

describe('planBundles', () => {
    const base = {
        appDir: APP_DIR,
        mainEntry: path.join(APP_DIR, 'electron/main.ts'),
        preloadEntry: '/node_modules/@chimera-engine/electron/dist/preload/api.js',
        alias: {},
        nodePaths: [],
    };

    it('plans a main bundle (electron + node:* external) and a preload bundle (electron external)', () => {
        const specs = planBundles(base);
        const main = specs.find((s) => s.label === 'main');
        const preload = specs.find((s) => s.label === 'preload');
        expect(main?.entry).toBe(base.mainEntry);
        expect(main?.outfile).toBe(path.join(APP_DIR, 'dist/electron/main.js'));
        expect(main?.external).toEqual(['electron', 'node:*']);
        expect(preload?.entry).toBe(base.preloadEntry);
        expect(preload?.outfile).toBe(path.join(APP_DIR, 'dist/preload/api.js'));
        expect(preload?.external).toEqual(['electron']);
    });

    it('omits the debug-preload bundle when no debug entry is supplied (portable default)', () => {
        const specs = planBundles(base);
        expect(specs.some((s) => s.label === 'debug-preload')).toBe(false);
    });

    it('includes the debug-preload bundle only when a debug entry is supplied (monorepo dev/e2e)', () => {
        const debugEntry = path.join(ROOT, 'electron/preload/debug-api.ts');
        const specs = planBundles({ ...base, debugPreloadEntry: debugEntry });
        const debug = specs.find((s) => s.label === 'debug-preload');
        expect(debug?.entry).toBe(debugEntry);
        expect(debug?.outfile).toBe(path.join(APP_DIR, 'dist/preload/debug-api.js'));
        expect(debug?.external).toEqual(['electron']);
    });

    it('threads the alias + nodePaths onto every bundle spec', () => {
        const alias = { '@chimera-engine/tactics': APP_DIR };
        const nodePaths = ['/tmp/nm'];
        const specs = planBundles({ ...base, alias, nodePaths });
        for (const spec of specs) {
            expect(spec.alias).toBe(alias);
            expect(spec.nodePaths).toBe(nodePaths);
        }
    });

    it('uses an explicit outfiles override when provided (e2e .e2e-build layout)', () => {
        const outfiles = {
            main: '/e2e/electron/main/index.js',
            preload: '/e2e/electron/preload/api.js',
            debugPreload: '/e2e/electron/preload/debug-api.js',
        };
        const specs = planBundles({
            ...base,
            outfiles,
            debugPreloadEntry: path.join(ROOT, 'electron/preload/debug-api.ts'),
        });
        expect(specs.find((s) => s.label === 'main')?.outfile).toBe(outfiles.main);
        expect(specs.find((s) => s.label === 'preload')?.outfile).toBe(outfiles.preload);
        expect(specs.find((s) => s.label === 'debug-preload')?.outfile).toBe(outfiles.debugPreload);
    });
});

describe('buildAppBundles', () => {
    function makeDeps(env: Record<string, string | undefined>) {
        const built: BundleSpec[] = [];
        const build: BuildFn = (spec) => {
            built.push(spec);
        };
        return {
            built,
            deps: {
                build,
                readJson: vi.fn((p: string) => {
                    expect(p).toBe(path.join(APP_DIR, 'package.json'));
                    return { name: GAME_PKG };
                }),
                resolvePreload: vi.fn(
                    () => '/node_modules/@chimera-engine/electron/dist/preload/api.js',
                ),
                env,
                root: ROOT,
                appDir: APP_DIR,
            },
        };
    }

    it('derives the game alias from package.json and bundles main + preload', () => {
        const { built, deps } = makeDeps({});
        buildAppBundles(deps);
        expect(deps.readJson).toHaveBeenCalledOnce();
        const labels = built.map((s) => s.label);
        expect(labels).toContain('main');
        expect(labels).toContain('preload');
        const main = built.find((s) => s.label === 'main');
        expect(main?.alias[GAME_PKG]).toBe(APP_DIR);
        expect(main?.alias['@chimera-engine/electron/main']).toBe(
            path.join(ROOT, 'electron/main/index.ts'),
        );
    });

    it('in verify:pack mode drops the electron/main alias and resolves the preload from the tarball', () => {
        const nm = '/tmp/consumer/node_modules';
        const { built, deps } = makeDeps({ [VERIFY_PACK_NODE_MODULES_ENV]: nm });
        buildAppBundles(deps);
        const preload = built.find((s) => s.label === 'preload');
        expect(preload?.nodePaths).toEqual([nm]);
        expect(preload?.alias['@chimera-engine/electron/main']).toBeUndefined();
        // preload entry was resolved from the consumer (verify:pack) require root.
        expect(deps.resolvePreload).toHaveBeenCalledWith(nm);
    });

    it('does not bundle a debug preload by default (production app is debug-free)', () => {
        const { built, deps } = makeDeps({});
        buildAppBundles(deps);
        expect(built.some((s) => s.label === 'debug-preload')).toBe(false);
    });

    it('honours an outfiles override + debug entry from deps (the e2e global-setup path)', () => {
        const { built, deps } = makeDeps({});
        const outfiles = {
            main: '/e2e/electron/main/index.js',
            preload: '/e2e/electron/preload/api.js',
            debugPreload: '/e2e/electron/preload/debug-api.js',
        };
        buildAppBundles({
            ...deps,
            outfiles,
            debugPreloadEntry: path.join(ROOT, 'electron/preload/debug-api.ts'),
        });
        expect(built.find((s) => s.label === 'main')?.outfile).toBe(outfiles.main);
        const debug = built.find((s) => s.label === 'debug-preload');
        expect(debug?.outfile).toBe(outfiles.debugPreload);
        expect(debug?.entry).toBe(path.join(ROOT, 'electron/preload/debug-api.ts'));
    });
});
