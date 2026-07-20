// apps/tactics/electron/build-main.ts
//
// The app-OWNED Electron bundler. Bundles this consumer app's Electron MAIN
// composition root (`electron/main.ts`, which constructs the game's
// `MainGameContribution` and calls the host `@chimera-engine/electron/main`'s `main()`)
// AND the host PRELOAD (`@chimera-engine/electron/preload/api`) into single runnable CJS
// files under the app's own `dist/`:
//
//   electron/main.ts                       → dist/electron/main.js   (package.json "main")
//   @chimera-engine/electron/preload/api          → dist/preload/api.js     (sibling the host
//                                            resolves at runtime: <main>/../preload/api.js)
//
// This lives INSIDE the app and names no other game: the `@chimera-engine/<game>` alias
// key is read from the app's own `package.json` `name`, so the file is copied verbatim
// into a scaffolded app
// (`tools/create-chimera-game/templates/blank/electron/build-main.ts`) with zero
// edits. It bundles the preload alongside main so `pnpm --filter <app> build:app`
// produces a fully standalone-launchable bundle.
//
// The pure config derivation below is shared with the app's E2E `global-setup.ts`
// (one source of truth for the esbuild alias / nodePaths), and honours the
// `verify:pack` true-artifact mode: when `CHIMERA_VERIFY_PACK_NODE_MODULES` points
// at a throwaway tarball install, the `@chimera-engine/electron/main` source alias is
// dropped and the preload is resolved from the packed artifact instead of source.

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

/**
 * Env var the `verify:pack` gate (tools/verify-pack.ts) sets to the throwaway
 * consumer's `node_modules`, flipping `@chimera-engine/*` resolution off the workspace
 * symlinks and onto the packed tarballs. Duplicated as a literal (not imported)
 * to keep the app off the `tools/` import boundary; both sides assert it in tests.
 */
export const VERIFY_PACK_NODE_MODULES_ENV = 'CHIMERA_VERIFY_PACK_NODE_MODULES';

/**
 * Env var the PACKAGING scripts set to mark a distributable build. `build:app`
 * is the same script an everyday dev launch runs, so packaging cannot be
 * inferred — it must be declared. Set by every `package:<game>*` script (and
 * asserted there by a drift test, so a forgotten flag fails loudly instead of
 * silently shipping a debug-capable bundle).
 */
export const PACKAGED_BUILD_ENV = 'CHIMERA_PACKAGED_BUILD';

/**
 * esbuild `define` for the app bundles (§4.12, Invariant #27).
 *
 * In a packaged build, bake the production identity so
 * `IS_DEBUG_MODE = process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production'`
 * constant-folds to the literal `false` in the emitted bundle. The debug bridge
 * then sits behind a permanently-false gate: even if the startup guard were
 * bypassed, `if (IS_DEBUG_MODE)` can never enter and no debug surface can be
 * registered. Verified by inspecting the emitted `dist/electron/main.js`:
 * packaged emits `IS_DEBUG_MODE = false`; a dev build keeps the runtime reads.
 *
 * BOTH reads must be defined. Replacing only `NODE_ENV` leaves
 * `process.env.CHIMERA_DEBUG === '1' && false`, which esbuild cannot reduce to a
 * literal (the env read is not provably side-effect-free). Baking `CHIMERA_DEBUG`
 * to empty is exactly right semantically: a packaged build must never honour it
 * (Invariant #27).
 *
 * NOT tree-shaking: the debug module graph still ships. `IS_DEBUG_MODE` crosses a
 * module boundary (it is imported from the built `@chimera-engine/simulation`
 * dist), so esbuild does not propagate the literal into the `if` and cannot drop
 * the branch or its dynamic import. Eliminating the graph from the bundle is a
 * separate, unsolved concern — do not claim it here without re-measuring.
 *
 * This does NOT blind the startup guard. The guard reads the flag as
 * `env['CHIMERA_DEBUG']` — bracket access on an injected `process.env`
 * reference, not a dot-access member expression — so `define` leaves it alone
 * and a packaged binary launched with `CHIMERA_DEBUG=1` still refuses to start.
 * Keys MUST stay dot-access; that is the only shape esbuild matches (invariant
 * Check 9 pins the constant's side of the same contract).
 *
 * Returns `{}` for everyday dev builds and for both e2e `global-setup`s, which
 * pass `process.env` without the flag: they share this bundler, and baking
 * production there would silently disable the F9 Inspector.
 *
 * This is defence in depth, not the enforcement — the packaged-aware startup
 * guard (`electron/main/startup-guard.ts`) is what refuses to start.
 */
export function computePackagedDefine(
    env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
    return env[PACKAGED_BUILD_ENV] === '1'
        ? { 'process.env.NODE_ENV': '"production"', 'process.env.CHIMERA_DEBUG': '""' }
        : {};
}

/** A single esbuild bundle to emit (main / preload / debug-preload). */
export interface BundleSpec {
    readonly label: 'main' | 'preload' | 'debug-preload';
    readonly entry: string;
    readonly outfile: string;
    readonly external: readonly string[];
    readonly alias: Readonly<Record<string, string>>;
    readonly nodePaths: readonly string[];
    /** Build-time constant replacement; see {@link computePackagedDefine}. */
    readonly define: Readonly<Record<string, string>>;
}

/** esbuild runner (buildSync-shaped); injected so unit tests bundle nothing. */
export type BuildFn = (spec: BundleSpec) => void;

/**
 * esbuild `nodePaths` for `@chimera-engine/*` resolution: the throwaway tarball
 * `node_modules` in `verify:pack` mode, otherwise empty (esbuild falls back to the
 * workspace symlinks, the everyday path).
 */
export function computeNodePaths(env: Readonly<Record<string, string | undefined>>): string[] {
    const nodeModules = env[VERIFY_PACK_NODE_MODULES_ENV];
    return nodeModules !== undefined && nodeModules.length > 0 ? [nodeModules] : [];
}

export interface AliasOptions {
    readonly root: string;
    /** Absolute app dir (e.g. `<root>/apps/tactics`). */
    readonly appDir: string;
    /** The app's own package name (e.g. `@chimera-engine/tactics`), read from its package.json. */
    readonly gamePackageName: string;
}

/**
 * esbuild `@chimera-engine/*` alias map for the Electron main + preload bundles.
 *
 * The app's own `@chimera-engine/<game>` always resolves to the consumer app source (it is
 * the game, not a packed engine artifact). `@chimera-engine/electron/main` is aliased onto
 * host SOURCE for the everyday suite: the main entry is the consumer's
 * composition root, which imports the host as a consumer would. In `verify:pack`
 * mode that alias is DROPPED so the host resolves from the packed `@chimera-engine/electron`
 * tarball — validating the real artifact end-to-end.
 */
export function computeEsbuildAlias(
    env: Readonly<Record<string, string | undefined>>,
    options: AliasOptions,
): Record<string, string> {
    const alias: Record<string, string> = {
        [options.gamePackageName]: options.appDir,
    };
    if (computeNodePaths(env).length === 0) {
        alias['@chimera-engine/electron/main'] = path.join(options.root, 'electron/main/index.ts');
    }
    return alias;
}

export interface BundleOutfiles {
    readonly main: string;
    readonly preload: string;
    readonly debugPreload: string;
}

/** The app's bundle output paths, derived from its dir (mirrors package.json "main"). */
export function appBundleOutfiles(appDir: string): BundleOutfiles {
    return {
        main: path.join(appDir, 'dist/electron/main.js'),
        preload: path.join(appDir, 'dist/preload/api.js'),
        debugPreload: path.join(appDir, 'dist/preload/debug-api.js'),
    };
}

/**
 * The host's Inspector-window debug preload SOURCE entry for the everyday dev
 * `build:app`, or `undefined` when it is absent. ONLY the monorepo carries that
 * source (`<root>/electron/preload/debug-api.ts`); a scaffolded game copies this
 * file verbatim but has no host source, so `fileExists` returns false and the
 * debug bundle is skipped — matching `@chimera-engine/electron/preload/debug-api`
 * being a private, non-public export (Invariant #27). Without this the dev `build:app`
 * would emit only `api.js`, so a dev launch's F9 would open an Inspector window whose
 * preload bridge could not load (the e2e `global-setup` builds the same entry into
 * `.e2e-build`, so e2e wouldn't catch it).
 */
export function resolveDevDebugPreloadEntry(
    root: string,
    fileExists: (file: string) => boolean,
): string | undefined {
    const entry = path.join(root, 'electron/preload/debug-api.ts');
    return fileExists(entry) ? entry : undefined;
}

/**
 * The Inspector-window debug preload entry resolved as the SIBLING of the app's already-resolved
 * api preload — the STANDALONE fallback. The installed `@chimera-engine/electron` tarball ships a
 * compiled `dist/preload/debug-api.js` next to `dist/preload/api.js` (via `files: ["dist"]`); it is
 * not a public `exports` subpath, but it is the very file the runtime loads as
 * `<preloadDir>/debug-api.js`. A scaffolded game has no monorepo host SOURCE
 * (`resolveDevDebugPreloadEntry` returns undefined) yet still wants F9, so `build:app` bundles this
 * compiled sibling. Returns undefined when no `fileExists` probe is injected (e.g. the e2e
 * global-setup, which stays debug-free) or the sibling is absent (an older engine tarball, or a
 * preload resolved off a source tree).
 */
export function resolveInstalledDebugPreloadEntry(
    apiPreloadPath: string,
    fileExists?: (file: string) => boolean,
): string | undefined {
    if (fileExists === undefined) return undefined;
    const sibling = path.join(path.dirname(apiPreloadPath), 'debug-api.js');
    return fileExists(sibling) ? sibling : undefined;
}

export interface PlanBundlesOptions {
    readonly appDir: string;
    readonly mainEntry: string;
    readonly preloadEntry: string;
    /**
     * The Inspector-window debug preload entry. Absent ⇒ no debug bundle (the
     * portable production default; `@chimera-engine/electron/preload/debug-api` is not a
     * public export — Invariant #27 — so only the monorepo dev/e2e build, which has
     * the host source, supplies it).
     */
    readonly debugPreloadEntry?: string;
    readonly alias: Readonly<Record<string, string>>;
    readonly nodePaths: readonly string[];
    /**
     * Build-time constant replacement, threaded onto every spec. Absent ⇒ none
     * (the dev/e2e default). See {@link computePackagedDefine}.
     */
    readonly define?: Readonly<Record<string, string>>;
    /**
     * Output paths override. Absent ⇒ the default `<appDir>/dist` layout
     * ({@link appBundleOutfiles}). The E2E `global-setup` passes its `.e2e-build`
     * layout so production and tests share one bundler with different sinks.
     */
    readonly outfiles?: BundleOutfiles;
}

/**
 * The deterministic bundle plan. Main externalises `electron` + `node:*` (Node main
 * context); the preload(s) run in a sandboxed renderer with only `electron` external.
 */
export function planBundles(options: PlanBundlesOptions): BundleSpec[] {
    const out = options.outfiles ?? appBundleOutfiles(options.appDir);
    const define = options.define ?? {};
    const specs: BundleSpec[] = [
        {
            label: 'main',
            entry: options.mainEntry,
            outfile: out.main,
            external: ['electron', 'node:*'],
            alias: options.alias,
            nodePaths: options.nodePaths,
            define,
        },
        {
            label: 'preload',
            entry: options.preloadEntry,
            outfile: out.preload,
            external: ['electron'],
            alias: options.alias,
            nodePaths: options.nodePaths,
            define,
        },
    ];
    if (options.debugPreloadEntry !== undefined) {
        specs.push({
            label: 'debug-preload',
            entry: options.debugPreloadEntry,
            outfile: out.debugPreload,
            external: ['electron'],
            alias: options.alias,
            nodePaths: options.nodePaths,
            define,
        });
    }
    return specs;
}

export interface BuildAppBundlesDeps {
    readonly build: BuildFn;
    /** Read + parse a JSON file (the app's package.json); injected for testability. */
    readonly readJson: (file: string) => { name?: string };
    /**
     * Resolve `@chimera-engine/electron/preload/api` to a concrete entry file. In
     * `verify:pack` mode it is given the throwaway `node_modules` so it resolves from
     * the packed tarball; otherwise called with no argument (resolve from the app).
     */
    readonly resolvePreload: (nodeModules?: string) => string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly root: string;
    readonly appDir: string;
    /** Optional monorepo-only debug preload entry (host source path); see PlanBundlesOptions. */
    readonly debugPreloadEntry?: string;
    /**
     * Existence probe (injected `existsSync`) for the STANDALONE debug-preload fallback: when no
     * monorepo-source `debugPreloadEntry` is supplied, resolve the packed engine's compiled
     * `debug-api.js` sibling of the api preload. Supplied only by the `build:app` CLI entry; absent
     * from the e2e global-setups, which stay debug-free. Keeps the fallback unit-testable.
     */
    readonly fileExists?: (file: string) => boolean;
    /** Optional output-path override (the E2E `.e2e-build` layout); see PlanBundlesOptions. */
    readonly outfiles?: BundleOutfiles;
    readonly log?: (message: string) => void;
}

/**
 * Derive the alias from the app's own package name, resolve the preload entry,
 * plan the bundles, and emit each through the injected `build`. The single runtime
 * entry point both `build:app` and the E2E `global-setup` drive.
 */
export function buildAppBundles(deps: BuildAppBundlesDeps): void {
    const pkg = deps.readJson(path.join(deps.appDir, 'package.json'));
    if (pkg.name === undefined) {
        throw new Error(`build:app: ${deps.appDir}/package.json is missing a "name"`);
    }

    const alias = computeEsbuildAlias(deps.env, {
        root: deps.root,
        appDir: deps.appDir,
        gamePackageName: pkg.name,
    });
    // Resolve nodePaths to ABSOLUTE against the app dir. A standalone app's scripts inject a
    // RELATIVE `CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules` (the only value a portable npm
    // script can set), but both esbuild's nodePaths and resolvePreload's `createRequire` need an
    // absolute path. Absolute values (the verify:pack / verify:scaffold gates) pass through
    // path.resolve unchanged, so this is backward-compatible.
    const nodePaths = computeNodePaths(deps.env).map((entry) => path.resolve(deps.appDir, entry));
    const verifyPackMode = nodePaths.length > 0;

    const preloadEntry = deps.resolvePreload(verifyPackMode ? nodePaths[0] : undefined);

    // The monorepo-SOURCE debug entry is never used in verify:pack mode (the gate excludes the
    // debug specs; the source is private). PRESERVED verbatim as the source-entry branch.
    const sourceDebugPreloadEntry = verifyPackMode ? undefined : deps.debugPreloadEntry;
    // STANDALONE FALLBACK: a scaffolded game supplies NO source entry AND its build:app always runs
    // in verify:pack mode (CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules, to resolve the engine from
    // node_modules) — which would drop the debug bundle and break F9. When (and only when) no source
    // entry was supplied, resolve the debug preload as the SIBLING of the resolved api preload (the
    // packed engine ships dist/preload/debug-api.js). Monorepo + e2e keep their exact behaviour: a
    // supplied source entry always takes the preserved verify:pack drop above. Optional keys are
    // spread in only when defined (exactOptionalPropertyTypes forbids explicit undefined).
    const debugPreloadEntry =
        deps.debugPreloadEntry === undefined
            ? resolveInstalledDebugPreloadEntry(preloadEntry, deps.fileExists)
            : sourceDebugPreloadEntry;
    const specs = planBundles({
        appDir: deps.appDir,
        mainEntry: path.join(deps.appDir, 'electron/main.ts'),
        preloadEntry,
        alias,
        nodePaths,
        define: computePackagedDefine(deps.env),
        ...(debugPreloadEntry !== undefined ? { debugPreloadEntry } : {}),
        ...(deps.outfiles !== undefined ? { outfiles: deps.outfiles } : {}),
    });

    for (const spec of specs) {
        deps.log?.(`bundling ${spec.label} → ${path.relative(deps.root, spec.outfile)}`);
        deps.build(spec);
    }
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────
//
// Runs only when this module is executed DIRECTLY via `tsx electron/build-main.ts`
// (the app's `build:app` script) — never when imported (the E2E `global-setup`
// imports `buildAppBundles`/helpers, and must not trigger a build on import). The
// `VITEST` guard additionally keeps esbuild + disk I/O out of the unit surface,
// matching tools/verify-pack.ts. CJS `__dirname`/`__filename` (not `import.meta`)
// keep the file loadable by both tsx and the Playwright transform that bundles
// global-setup (a stray `import.meta` makes the latter emit a CJS/ESM mismatch).

/** True only when process argv[1] is this very file (direct `tsx` invocation). */
function isDirectRun(): boolean {
    const entry = process.argv[1];
    if (entry === undefined) return false;
    try {
        return path.resolve(entry) === __filename;
    } catch {
        return false;
    }
}

if (process.env['VITEST'] === undefined && isDirectRun()) {
    const appDir = path.resolve(__dirname, '..');
    const root = path.resolve(appDir, '../..');

    const build: BuildFn = (spec) => {
        mkdirSync(path.dirname(spec.outfile), { recursive: true });
        buildSync({
            entryPoints: [spec.entry],
            outfile: spec.outfile,
            bundle: true,
            platform: 'node',
            format: 'cjs',
            target: 'node20',
            // Emit external `.map` files so a debugger (VSCode "Debug Tactics"
            // launch config) can bind breakpoints in the original TypeScript
            // source rather than the bundled output. Harmless in packaged
            // builds (a sibling `.map` next to each bundle).
            sourcemap: true,
            external: [...spec.external],
            alias: { ...spec.alias },
            nodePaths: [...spec.nodePaths],
            // Empty for dev/e2e builds; bakes NODE_ENV=production (so
            // IS_DEBUG_MODE folds to false) only when the packaging scripts
            // declare CHIMERA_PACKAGED_BUILD=1. See computePackagedDefine.
            define: { ...spec.define },
        });
    };

    const resolvePreload = (nodeModules?: string): string => {
        // From the consumer's package.json (verify:pack) or the app's own — both
        // resolve `@chimera-engine/electron/preload/api` through the package `exports` map.
        const fromPackageJson =
            nodeModules !== undefined
                ? path.join(path.dirname(nodeModules), 'package.json')
                : path.join(appDir, 'package.json');
        return createRequire(fromPackageJson).resolve('@chimera-engine/electron/preload/api');
    };

    // Bundle the Inspector-window debug preload. In the monorepo the host SOURCE is present, so
    // `resolveDevDebugPreloadEntry` returns it. A scaffolded game has no host source (undefined), so
    // `buildAppBundles` falls back — via the injected `fileExists` probe — to the packed engine's
    // compiled `debug-api.js` sibling of the api preload, keeping F9 working out of the box. Spread
    // the source entry in only when defined — exactOptionalPropertyTypes forbids explicit `undefined`.
    const debugPreloadEntry = resolveDevDebugPreloadEntry(root, existsSync);

    buildAppBundles({
        build,
        readJson: (file) => JSON.parse(readFileSync(file, 'utf8')) as { name?: string },
        resolvePreload,
        env: process.env,
        root,
        appDir,
        fileExists: existsSync,
        ...(debugPreloadEntry !== undefined ? { debugPreloadEntry } : {}),
        log: (message) => console.log(`[build:app] ${message}`),
    });
}
