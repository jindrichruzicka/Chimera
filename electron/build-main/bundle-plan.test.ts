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
    esbuildBundleOptions,
    planBundles,
    buildAppBundles,
    createEsbuildBuild,
    resolveDevDebugPreloadEntry,
    resolveInstalledDebugPreloadEntry,
    type BuildFn,
    type BundleSpec,
    type EsbuildBundleOptions,
} from './bundle-plan.js';

/**
 * electron/build-main/bundle-plan.test.ts
 *
 * Unit guard for the engine-owned Electron bundle plan (§4.12, Invariant #27).
 * These tests exercise the PURE derivation — the packaging define, alias map,
 * output paths, and the bundle plan — with esbuild + disk injected by the
 * caller, so the suite spawns nothing and touches no real files.
 *
 * The fixtures name no game: the plan reads the app's `@chimera-engine/<game>`
 * alias key out of the app's own `package.json`, and the engine package must
 * work identically for the monorepo reference app and every scaffolded game.
 */

const ROOT = '/repo';
const APP_DIR = path.join(ROOT, 'apps/example');
const GAME_PKG = '@chimera-engine/example';

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

    // ── The adopter alias escape hatch ───────────────────────────────────────
    it('merges an alias override OVER the derived map', () => {
        const alias = computeEsbuildAlias(
            {},
            { ...opts, aliasOverrides: { 'some-cjs-only-dep': '/repo/shims/dep.ts' } },
        );
        expect(alias['some-cjs-only-dep']).toBe('/repo/shims/dep.ts');
        // …without disturbing what the plan derived.
        expect(alias[GAME_PKG]).toBe(APP_DIR);
        expect(alias['@chimera-engine/electron/main']).toBe(
            path.join(ROOT, 'electron/main/index.ts'),
        );
    });

    it('lets an override replace the host main alias (the point of the hatch)', () => {
        const alias = computeEsbuildAlias(
            {},
            { ...opts, aliasOverrides: { '@chimera-engine/electron/main': '/elsewhere/main.ts' } },
        );
        expect(alias['@chimera-engine/electron/main']).toBe('/elsewhere/main.ts');
    });

    it('RESTORES the game-package key an override tried to take over', () => {
        // The game alias is what makes the app's own source reachable from its
        // composition root. Pointed anywhere else, `build:app` silently bundles a
        // different game — so this key is the one the hatch may not have.
        const alias = computeEsbuildAlias(
            {},
            { ...opts, aliasOverrides: { [GAME_PKG]: '/somewhere/else' } },
        );
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

describe('esbuildBundleOptions', () => {
    const spec: BundleSpec = {
        label: 'main',
        entry: path.join(APP_DIR, 'electron/main.ts'),
        outfile: path.join(APP_DIR, 'dist/electron/main.js'),
        external: ['electron', 'node:*'],
        alias: { [GAME_PKG]: APP_DIR },
        nodePaths: [],
        define: {},
    };

    it('emits EXTERNAL source maps, never inline', () => {
        // `sourcemap: true` is load-bearing in a way it does not look: switched to
        // `'inline'` it embeds the original TypeScript — debug sources included —
        // inside the shipped `main.js`, where the external `.map` files never
        // travel, and base64 hides every marker the packaged-bundle gate scans for.
        expect(esbuildBundleOptions(spec).sourcemap).toBe(true);
    });

    it('carries the spec through verbatim, so nothing is derived twice', () => {
        const options = esbuildBundleOptions(spec);
        expect(options.entryPoints).toEqual([spec.entry]);
        expect(options.outfile).toBe(spec.outfile);
        expect(options.external).toEqual([...spec.external]);
        expect(options.alias).toEqual({ ...spec.alias });
        expect(options.nodePaths).toEqual([...spec.nodePaths]);
        expect(options.define).toEqual({ ...spec.define });
    });

    it('threads the packaging define into the options esbuild actually receives', () => {
        // The sole link between computePackagedDefine and the emitted bytes.
        const define = { 'process.env.NODE_ENV': '"production"' };
        expect(esbuildBundleOptions({ ...spec, define }).define).toEqual(define);
    });
});

describe('createEsbuildBuild', () => {
    // The factory every driver's CLI reaches esbuild through, and the reason the
    // real-bundle assertions can EXECUTE the shipped invocation instead of
    // reading it. Both injected dependencies are covered: `runBuild` is the whole
    // point, and `ensureDir` is the one that fails silently — esbuild creates no
    // parent directory, so dropping it turns `build:app` into an ENOENT the unit
    // surface never sees, because every other test injects a no-op `BuildFn`.
    const spec: BundleSpec = {
        label: 'main',
        entry: path.join(APP_DIR, 'electron/main.ts'),
        outfile: path.join(APP_DIR, 'dist/electron/main.js'),
        external: ['electron', 'node:*'],
        alias: {},
        nodePaths: [],
        define: { 'process.env.NODE_ENV': '"production"' },
    };

    function capture() {
        const dirs: string[] = [];
        const options: EsbuildBundleOptions[] = [];
        const build = createEsbuildBuild({
            runBuild: (received) => options.push(received),
            ensureDir: (dir) => dirs.push(dir),
        });
        return { build, dirs, options };
    }

    it('ensures the outfile’s PARENT directory before running the bundler', () => {
        const { build, dirs } = capture();
        build(spec);
        expect(dirs).toEqual([path.join(APP_DIR, 'dist/electron')]);
    });

    it('hands the bundler exactly the option set esbuildBundleOptions derives', () => {
        // Equality with the derivation, not a restatement of it: an option added
        // there must arrive here without this case being edited, which is what
        // makes "the assertions execute the shipped invocation" true.
        const { build, options } = capture();
        build(spec);
        expect(options).toEqual([esbuildBundleOptions(spec)]);
    });

    it('runs one bundle per call, in ensure-then-build order', () => {
        const order: string[] = [];
        const build = createEsbuildBuild({
            runBuild: () => order.push('build'),
            ensureDir: () => order.push('ensureDir'),
        });
        build(spec);
        expect(order).toEqual(['ensureDir', 'build']);
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
    // the reference app's packaged-bundle-content.test.ts; these cases cover only
    // the define's derivation.
    // Dev `build:app` and the e2e global-setups must NOT get the define — they
    // share this plan, and baking production there would silently kill the F9
    // Inspector.

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
        const alias = { [GAME_PKG]: APP_DIR };
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

    // ── The adopter external/extra-bundle escape hatch ────────────────────────
    describe('external overrides', () => {
        it('APPENDS to a label’s externals rather than replacing them', () => {
            // `electron` and `node:*` are not preferences: bundling either breaks
            // the emitted main. A hatch that replaced them would look like it
            // worked until the app failed to launch.
            const specs = planBundles({
                ...base,
                external: { main: ['better-sqlite3'], preload: ['some-native-addon'] },
            });
            expect(specs.find((s) => s.label === 'main')?.external).toEqual([
                'electron',
                'node:*',
                'better-sqlite3',
            ]);
            expect(specs.find((s) => s.label === 'preload')?.external).toEqual([
                'electron',
                'some-native-addon',
            ]);
        });

        it('appends to the debug-preload too — every planned label is wired', () => {
            // One case per fork. `main` and `preload` above would both pass while
            // this third lookup was dropped entirely: the case below asserts the
            // debug-preload's externals only for a build with NO override, which
            // an unwired fork satisfies exactly.
            const specs = planBundles({
                ...base,
                debugPreloadEntry: path.join(ROOT, 'electron/preload/debug-api.ts'),
                external: { 'debug-preload': ['some-native-addon'] },
            });
            expect(specs.find((s) => s.label === 'debug-preload')?.external).toEqual([
                'electron',
                'some-native-addon',
            ]);
        });

        it('leaves a label with no override untouched', () => {
            const specs = planBundles({
                ...base,
                debugPreloadEntry: path.join(ROOT, 'electron/preload/debug-api.ts'),
                external: { main: ['better-sqlite3'] },
            });
            expect(specs.find((s) => s.label === 'preload')?.external).toEqual(['electron']);
            expect(specs.find((s) => s.label === 'debug-preload')?.external).toEqual(['electron']);
        });

        it('does not duplicate an entry the base list already carries', () => {
            const specs = planBundles({ ...base, external: { main: ['electron', 'node:*'] } });
            expect(specs.find((s) => s.label === 'main')?.external).toEqual(['electron', 'node:*']);
        });

        it('rejects a misspelt planned label at COMPILE time', () => {
            // The map is keyed to the closed PlannedBundleLabel precisely so this
            // is an error. Keyed to the widened BundleLabel it would type-check,
            // append nothing, and no runtime check would ever notice — the whole
            // hatch silently no-ops on one transposed character.
            //
            // `tsc --noEmit -p electron/tsconfig.json` is the assertion; the
            // runtime body only proves the well-spelled twin still works, so a
            // hatch deleted outright cannot pass this by erroring on both.
            const specs = planBundles({
                ...base,
                // @ts-expect-error — 'preloadd' is not a PlannedBundleLabel
                external: { preloadd: ['x'] },
            });
            expect(specs.find((s) => s.label === 'preload')?.external).toEqual(['electron']);
            expect(
                planBundles({ ...base, external: { preload: ['x'] } }).find(
                    (s) => s.label === 'preload',
                )?.external,
            ).toEqual(['electron', 'x']);
        });
    });

    describe('mainEntry override', () => {
        it('is what the plan bundles as main', () => {
            const specs = planBundles({ ...base, mainEntry: '/repo/apps/example/src/boot.ts' });
            expect(specs.find((s) => s.label === 'main')?.entry).toBe(
                '/repo/apps/example/src/boot.ts',
            );
        });
    });

    describe('extraBundles', () => {
        it('plans each extra bundle alongside main + preload, with the shared alias/nodePaths/define', () => {
            const alias = { [GAME_PKG]: APP_DIR };
            const nodePaths = ['/tmp/nm'];
            const define = { 'process.env.NODE_ENV': '"production"' };
            const specs = planBundles({
                ...base,
                alias,
                nodePaths,
                define,
                extraBundles: [
                    {
                        label: 'worker',
                        entry: path.join(APP_DIR, 'electron/worker.ts'),
                        outfile: path.join(APP_DIR, 'dist/electron/worker.js'),
                    },
                ],
            });
            expect(specs.map((s) => s.label)).toEqual(['main', 'preload', 'worker']);
            const worker = specs.find((s) => s.label === 'worker');
            expect(worker?.entry).toBe(path.join(APP_DIR, 'electron/worker.ts'));
            expect(worker?.outfile).toBe(path.join(APP_DIR, 'dist/electron/worker.js'));
            expect(worker?.alias).toBe(alias);
            expect(worker?.nodePaths).toBe(nodePaths);
            expect(worker?.define).toBe(define);
        });

        it('externalises electron by default and appends the extra bundle’s own externals', () => {
            // An extra bundle's externals ride on its own declaration rather than
            // in a map keyed by its label: its label is an arbitrary string, so a
            // keyed lookup could never be spell-checked and a typo would silently
            // apply nothing.
            const specs = planBundles({
                ...base,
                extraBundles: [
                    { label: 'worker', entry: '/e.ts', outfile: '/o.js', external: ['node:*'] },
                    { label: 'second-preload', entry: '/p.ts', outfile: '/p.js' },
                ],
            });
            expect(specs.find((s) => s.label === 'worker')?.external).toEqual([
                'electron',
                'node:*',
            ]);
            expect(specs.find((s) => s.label === 'second-preload')?.external).toEqual(['electron']);
        });

        it('plans none by default, so the default three-bundle plan is unchanged', () => {
            expect(planBundles(base).map((s) => s.label)).toEqual(['main', 'preload']);
        });
    });
});

describe('resolveDevDebugPreloadEntry', () => {
    it('returns the host debug preload SOURCE when it exists (monorepo dev build)', () => {
        const entry = resolveDevDebugPreloadEntry(ROOT, () => true);
        expect(entry).toBe(path.join(ROOT, 'electron/preload/debug-api.ts'));
    });

    it('returns undefined when the host source is absent (a scaffolded game has none)', () => {
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

    it('throws when the app package.json declares no name (the alias key has no source)', () => {
        const { deps } = makeDeps({});
        expect(() => buildAppBundles({ ...deps, readJson: () => ({}) })).toThrow(/"name"/);
    });

    it('bundles the app composition root by default', () => {
        const { built, deps } = makeDeps({});
        buildAppBundles(deps);
        expect(built.find((s) => s.label === 'main')?.entry).toBe(
            path.join(APP_DIR, 'electron/main.ts'),
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

    it('resolves a RELATIVE verify:pack node_modules against the app dir', () => {
        // A standalone app's scripts inject `CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules`
        // — the only value a portable npm script can set — but esbuild's nodePaths
        // and resolvePreload's createRequire both need an absolute path.
        const { built, deps } = makeDeps({ [VERIFY_PACK_NODE_MODULES_ENV]: 'node_modules' });
        buildAppBundles(deps);
        const expected = path.join(APP_DIR, 'node_modules');
        expect(built.find((s) => s.label === 'main')?.nodePaths).toEqual([expected]);
        expect(deps.resolvePreload).toHaveBeenCalledWith(expected);
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

    it('logs one line per planned bundle through the injected sink', () => {
        // The plan never calls `console.*` — a published engine module has no
        // business owning a consumer's build output format.
        const messages: string[] = [];
        const { deps } = makeDeps({});
        buildAppBundles({ ...deps, log: (message) => messages.push(message) });
        expect(messages).toHaveLength(2);
        expect(messages[0]).toContain('main');
        expect(messages[1]).toContain('preload');
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

    // ── The plan overrides, threaded end-to-end ──────────────────────────────
    describe('plan overrides', () => {
        it('threads mainEntry / alias / external / extraBundles through to the specs', () => {
            const { built, deps } = makeDeps({});
            buildAppBundles({
                ...deps,
                overrides: {
                    mainEntry: path.join(APP_DIR, 'src/boot.ts'),
                    alias: { 'some-dep': '/shims/dep.ts' },
                    external: { main: ['better-sqlite3'] },
                    extraBundles: [
                        {
                            label: 'worker',
                            entry: path.join(APP_DIR, 'electron/worker.ts'),
                            outfile: path.join(APP_DIR, 'dist/electron/worker.js'),
                        },
                    ],
                },
            });
            const main = built.find((s) => s.label === 'main');
            expect(main?.entry).toBe(path.join(APP_DIR, 'src/boot.ts'));
            expect(main?.alias['some-dep']).toBe('/shims/dep.ts');
            expect(main?.alias[GAME_PKG]).toBe(APP_DIR);
            expect(main?.external).toEqual(['electron', 'node:*', 'better-sqlite3']);
            expect(built.map((s) => s.label)).toEqual(['main', 'preload', 'worker']);
        });

        it('changes nothing when absent', () => {
            const { built: withOut, deps: depsA } = makeDeps({});
            buildAppBundles(depsA);
            const { built: withEmpty, deps: depsB } = makeDeps({});
            buildAppBundles({ ...depsB, overrides: {} });
            expect(withEmpty).toEqual(withOut);
        });
    });
});
