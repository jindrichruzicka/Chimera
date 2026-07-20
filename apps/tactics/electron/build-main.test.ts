import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    PACKAGED_BUILD_ENV,
    VERIFY_PACK_NODE_MODULES_ENV,
    computePackagedDefine,
    isPackagedBuild,
    computeNodePaths,
    computeEsbuildAlias,
    appBundleOutfiles,
    planBundles,
    buildAppBundles,
    resolveDevDebugPreloadEntry,
    resolveInstalledDebugPreloadEntry,
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

describe('computePackagedDefine', () => {
    // Invariant #27 / §4.12: a PACKAGED bundle bakes the production identity so
    // IS_DEBUG_MODE constant-folds to the literal `false`, leaving the debug
    // bridge behind a permanently-dead gate. The same two defines are also what
    // let the debug module graph LEAVE the bundle: the gate in
    // electron/main/index.ts inlines this expression rather than testing the
    // imported constant, so esbuild can fold it locally and prune the dynamic
    // imports behind it. That graph-absence is asserted against a real bundle in
    // __tests__/packaged-bundle-content.test.ts; these cases cover only the
    // define's derivation.
    // Dev `build:app` and the e2e global-setups must NOT get the define — they
    // share this bundler, and baking production there would silently kill the
    // F9 Inspector.

    it('bakes BOTH IS_DEBUG_MODE reads when the packaged-build flag is set', () => {
        // Defining only NODE_ENV leaves `process.env.CHIMERA_DEBUG === '1' && false`,
        // which esbuild cannot reduce to a literal — so IS_DEBUG_MODE would stay
        // a runtime read and the gate would remain LIVE in a distributable.
        expect(computePackagedDefine({ [PACKAGED_BUILD_ENV]: '1' })).toEqual({
            'process.env.NODE_ENV': '"production"',
            'process.env.CHIMERA_DEBUG': '""',
        });
    });

    it('bakes nothing for an everyday dev build (flag absent)', () => {
        expect(computePackagedDefine({})).toEqual({});
    });

    it('bakes nothing for any value other than the exact "1"', () => {
        expect(computePackagedDefine({ [PACKAGED_BUILD_ENV]: '0' })).toEqual({});
        expect(computePackagedDefine({ [PACKAGED_BUILD_ENV]: 'true' })).toEqual({});
        expect(computePackagedDefine({ [PACKAGED_BUILD_ENV]: '' })).toEqual({});
    });

    it('replaces DOT-access member expressions, the only shape esbuild define matches', () => {
        // Invariant #27 Check 9 pins IS_DEBUG_MODE's dot access for exactly this
        // reason; a bracket-access key here would silently never match.
        for (const key of Object.keys(computePackagedDefine({ [PACKAGED_BUILD_ENV]: '1' }))) {
            expect(key).toMatch(/^process\.env\.[A-Z_]+$/);
        }
    });
});

describe('isPackagedBuild', () => {
    // The single reading of the packaging signal. Two decisions consume it — the
    // production define and the debug-preload drop — and a half-excluded artifact
    // (define baked but preload emitted, or vice versa) is the failure mode that
    // sharing one predicate exists to prevent.
    it('is true only for the exact "1"', () => {
        expect(isPackagedBuild({ [PACKAGED_BUILD_ENV]: '1' })).toBe(true);
        for (const value of ['0', 'true', '', undefined]) {
            expect(isPackagedBuild({ [PACKAGED_BUILD_ENV]: value })).toBe(false);
        }
        expect(isPackagedBuild({})).toBe(false);
    });

    it('agrees with both consumers, so the artifact can never be half-excluded', () => {
        for (const env of [{ [PACKAGED_BUILD_ENV]: '1' }, {}, { [PACKAGED_BUILD_ENV]: '0' }]) {
            const packaged = isPackagedBuild(env);
            // Consumer 1: the define is baked iff packaged.
            expect(Object.keys(computePackagedDefine(env)).length > 0).toBe(packaged);
            // Consumer 2: the debug preload is planned iff NOT packaged.
            const built: BundleSpec[] = [];
            buildAppBundles({
                build: (spec) => built.push(spec),
                readJson: () => ({ name: GAME_PKG }),
                resolvePreload: () => '/node_modules/@chimera-engine/electron/dist/preload/api.js',
                env,
                root: ROOT,
                appDir: APP_DIR,
                debugPreloadEntry: path.join(ROOT, 'electron/preload/debug-api.ts'),
            });
            expect(built.some((s) => s.label === 'debug-preload')).toBe(!packaged);
        }
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

    it('threads the define onto every bundle spec', () => {
        const define = { 'process.env.NODE_ENV': '"production"' };
        const specs = planBundles({
            ...base,
            define,
            debugPreloadEntry: path.join(ROOT, 'electron/preload/debug-api.ts'),
        });
        for (const spec of specs) {
            expect(spec.define).toBe(define);
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

describe('resolveDevDebugPreloadEntry', () => {
    it('returns the host debug preload SOURCE when it exists (monorepo dev build)', () => {
        const entry = resolveDevDebugPreloadEntry(ROOT, () => true);
        expect(entry).toBe(path.join(ROOT, 'electron/preload/debug-api.ts'));
    });

    it('returns undefined when the host source is absent (a scaffolded game copies this verbatim)', () => {
        expect(resolveDevDebugPreloadEntry(ROOT, () => false)).toBeUndefined();
    });

    it('probes exactly the <root>/electron/preload/debug-api.ts path', () => {
        const probed: string[] = [];
        resolveDevDebugPreloadEntry(ROOT, (file) => {
            probed.push(file);
            return false;
        });
        expect(probed).toEqual([path.join(ROOT, 'electron/preload/debug-api.ts')]);
    });
});

describe('resolveInstalledDebugPreloadEntry', () => {
    const API = '/nm/@chimera-engine/electron/dist/preload/api.js';
    const SIBLING = '/nm/@chimera-engine/electron/dist/preload/debug-api.js';

    it('returns the compiled debug-api.js sibling of the resolved api preload when it exists', () => {
        expect(resolveInstalledDebugPreloadEntry(API, () => true)).toBe(SIBLING);
    });

    it('returns undefined when the sibling is absent (older engine tarball / source-tree preload)', () => {
        expect(resolveInstalledDebugPreloadEntry(API, () => false)).toBeUndefined();
    });

    it('returns undefined when no fileExists probe is injected (the e2e global-setup stays debug-free)', () => {
        expect(resolveInstalledDebugPreloadEntry(API)).toBeUndefined();
    });

    it('probes exactly the debug-api.js sibling of the api preload dir', () => {
        const probed: string[] = [];
        resolveInstalledDebugPreloadEntry(API, (file) => {
            probed.push(file);
            return false;
        });
        expect(probed).toEqual([SIBLING]);
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

    it('bakes the production define into every bundle when the packaged-build flag is set', () => {
        const { built, deps } = makeDeps({ [PACKAGED_BUILD_ENV]: '1' });
        buildAppBundles(deps);
        expect(built.length).toBeGreaterThan(0);
        for (const spec of built) {
            expect(spec.define).toEqual({
                'process.env.NODE_ENV': '"production"',
                'process.env.CHIMERA_DEBUG': '""',
            });
        }
    });

    it('bakes NO define for an everyday dev build, keeping the F9 debug bridge reachable', () => {
        // The single most important regression guard for the define: `build:app`
        // is the SAME script dev launches and packaging both run, so a leaked
        // flag would kill the Inspector with no error message.
        const { built, deps } = makeDeps({});
        buildAppBundles(deps);
        for (const spec of built) {
            expect(spec.define).toEqual({});
        }
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

    // Standalone F9 fix: a scaffolded game supplies NO source debug entry, and its build:app
    // ALWAYS runs in verify:pack mode (CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules, to resolve
    // the engine from node_modules). The fallback resolves the packed sibling of api.js so F9 works.
    it('falls back to the packed debug-api.js sibling in verify:pack mode when no source entry is supplied', () => {
        const nm = '/tmp/consumer/node_modules';
        const { built, deps } = makeDeps({ [VERIFY_PACK_NODE_MODULES_ENV]: nm });
        // resolvePreload (makeDeps default) resolves the api preload from the packed engine;
        // its sibling debug-api.js is the fallback entry.
        buildAppBundles({ ...deps, fileExists: () => true });
        const debug = built.find((s) => s.label === 'debug-preload');
        expect(debug?.entry).toBe(
            '/node_modules/@chimera-engine/electron/dist/preload/debug-api.js',
        );
        expect(debug?.outfile).toBe(path.join(APP_DIR, 'dist/preload/debug-api.js'));
    });

    it('PRESERVES the verify:pack drop: a supplied SOURCE debug entry is dropped, fallback not taken', () => {
        const nm = '/tmp/consumer/node_modules';
        const { built, deps } = makeDeps({ [VERIFY_PACK_NODE_MODULES_ENV]: nm });
        buildAppBundles({
            ...deps,
            debugPreloadEntry: path.join(ROOT, 'electron/preload/debug-api.ts'),
            fileExists: () => true,
        });
        // The source entry takes the verify:pack drop (undefined); the sibling fallback fires only
        // when NO source entry was supplied — so no debug bundle here.
        expect(built.some((s) => s.label === 'debug-preload')).toBe(false);
    });

    it('does not fall back when no fileExists probe is injected (protects the e2e global-setup path)', () => {
        const nm = '/tmp/consumer/node_modules';
        const { built, deps } = makeDeps({ [VERIFY_PACK_NODE_MODULES_ENV]: nm });
        buildAppBundles(deps);
        expect(built.some((s) => s.label === 'debug-preload')).toBe(false);
    });

    // ── Packaged builds ship no debug preload at all (§4.12) ──────────────────
    //
    // `dist/preload/debug-api.js` is the largest debug artifact on disk — ~532 KB
    // plus a ~1.06 MB sourcemap. It never reached a distributable (electron-builder's
    // `files` allowlist names `dist/preload/api.js` only), so this drop is about the
    // packaging build's OUTPUT TREE, not about shipped bytes. It is also unreachable
    // even when present: the Inspector window that loads it is only ever created from
    // behind the folded-dead debug gate. Both entry routes must be suppressed, so the
    // check applies to the RESOLVED entry rather than to either branch that produces it.
    describe('packaged builds emit no debug preload', () => {
        const SOURCE_ENTRY = path.join(ROOT, 'electron/preload/debug-api.ts');

        it('drops the monorepo SOURCE debug entry when the packaged-build flag is set', () => {
            const { built, deps } = makeDeps({ [PACKAGED_BUILD_ENV]: '1' });
            buildAppBundles({ ...deps, debugPreloadEntry: SOURCE_ENTRY });
            expect(built.map((s) => s.label)).toEqual(['main', 'preload']);
        });

        // Anti-vacuity for the case above: the same call WITHOUT the flag must
        // still emit it, or the assertion could pass for an unrelated reason.
        it('still emits it for the same build without the flag', () => {
            const { built, deps } = makeDeps({});
            buildAppBundles({ ...deps, debugPreloadEntry: SOURCE_ENTRY });
            expect(built.some((s) => s.label === 'debug-preload')).toBe(true);
        });

        // The path that ships a SCAFFOLDED distributable: a standalone game
        // supplies no source entry and always runs verify:pack, so the packed
        // sibling fallback — not the source branch — is what would otherwise
        // leak the preload into someone else's shipped app.
        it('drops the packed-sibling FALLBACK too, so scaffolded distributables stay clean', () => {
            const { built, deps } = makeDeps({
                [VERIFY_PACK_NODE_MODULES_ENV]: '/tmp/consumer/node_modules',
                [PACKAGED_BUILD_ENV]: '1',
            });
            buildAppBundles({ ...deps, fileExists: () => true });
            expect(built.map((s) => s.label)).toEqual(['main', 'preload']);
        });
    });
});
