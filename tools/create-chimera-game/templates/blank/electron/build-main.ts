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
// This file names no game: the `@chimera-engine/<game>` alias key is read from the app's
// own `package.json` `name`, so it is IDENTICAL across every create-chimera-game
// app — never edit it after scaffolding. It also bundles the preload, making
// `pnpm --filter <app> build:app` produce a fully launchable bundle.
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

/** A single esbuild bundle to emit (main / preload / debug-preload). */
export interface BundleSpec {
    readonly label: 'main' | 'preload' | 'debug-preload';
    readonly entry: string;
    readonly outfile: string;
    readonly external: readonly string[];
    readonly alias: Readonly<Record<string, string>>;
    readonly nodePaths: readonly string[];
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
    /** Absolute app dir (e.g. `<root>/apps/<game>`). */
    readonly appDir: string;
    /** The app's own package name (e.g. `@chimera-engine/<game>`), read from its package.json. */
    readonly gamePackageName: string;
}

/**
 * esbuild `@chimera-engine/*` alias map for the Electron main + preload bundles.
 *
 * The app's own `@chimera-engine/<game>` always resolves to the consumer app source (it is
 * the game, not a packed engine artifact). `@chimera-engine/electron/main` is aliased onto
 * host SOURCE for the everyday suite (#778: the main entry is the consumer's
 * composition root, which imports the host as a consumer would). In `verify:pack`
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
 * being a private, non-public export (Invariant #27). Without this, `build:app`
 * emitted only `api.js` and never `debug-api.js`, so a dev launch's F9 opened an
 * Inspector window whose preload bridge could not load (the e2e `global-setup`
 * already builds the same entry into `.e2e-build`, which is why e2e stayed green).
 */
export function resolveDevDebugPreloadEntry(
    root: string,
    fileExists: (file: string) => boolean,
): string | undefined {
    const entry = path.join(root, 'electron/preload/debug-api.ts');
    return fileExists(entry) ? entry : undefined;
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
    const specs: BundleSpec[] = [
        {
            label: 'main',
            entry: options.mainEntry,
            outfile: out.main,
            external: ['electron', 'node:*'],
            alias: options.alias,
            nodePaths: options.nodePaths,
        },
        {
            label: 'preload',
            entry: options.preloadEntry,
            outfile: out.preload,
            external: ['electron'],
            alias: options.alias,
            nodePaths: options.nodePaths,
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

    // The debug preload is a dev/e2e convenience only and never ships in a verify:pack
    // run (the gate excludes the debug specs; #27 keeps it private). Optional keys are
    // spread in only when defined (exactOptionalPropertyTypes forbids explicit undefined).
    const debugPreloadEntry = verifyPackMode ? undefined : deps.debugPreloadEntry;
    const specs = planBundles({
        appDir: deps.appDir,
        mainEntry: path.join(deps.appDir, 'electron/main.ts'),
        preloadEntry,
        alias,
        nodePaths,
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
            external: [...spec.external],
            alias: { ...spec.alias },
            nodePaths: [...spec.nodePaths],
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

    // Bundle the Inspector-window debug preload too when the monorepo host source is
    // present (it is for any in-repo app; absent for a scaffolded game that copies this
    // file verbatim). `buildAppBundles` itself drops it in verify:pack mode. Spread in
    // only when defined — exactOptionalPropertyTypes forbids an explicit `undefined`.
    const debugPreloadEntry = resolveDevDebugPreloadEntry(root, existsSync);

    buildAppBundles({
        build,
        readJson: (file) => JSON.parse(readFileSync(file, 'utf8')) as { name?: string },
        resolvePreload,
        env: process.env,
        root,
        appDir,
        ...(debugPreloadEntry !== undefined ? { debugPreloadEntry } : {}),
        log: (message) => console.log(`[build:app] ${message}`),
    });
}
