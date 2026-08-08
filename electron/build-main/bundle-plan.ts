/**
 * electron/build-main/bundle-plan.ts
 *
 * The engine-owned Electron bundle PLAN behind every consumer app's `build:app`
 * (§3 module boundaries, §4.12 Runtime Debug Layer). It derives — from an app's
 * own directory, package name and environment — the esbuild alias map, the
 * `nodePaths`, the packaging `define`, and the list of bundles to emit:
 *
 *   <appDir>/electron/main.ts                → dist/electron/main.js  (package.json "main")
 *   @chimera-engine/electron/preload/api     → dist/preload/api.js    (the sibling the host
 *                                              resolves at runtime: <main>/../preload/api.js)
 *   @chimera-engine/electron/preload/debug-api → dist/preload/debug-api.js (dev/e2e only)
 *
 * Why this lives in the ENGINE package. The property the plan protects is an
 * engine property: Invariant #27 rests on the `define` below reaching esbuild,
 * and the debug graph it prunes is engine code. Every consumer app must get it —
 * the monorepo reference app AND every scaffolded game, whose copy of a
 * duplicated plan would freeze at scaffold time and receive no engine fix. So
 * each consumer runs a THIN, adopter-editable DRIVER
 * (`apps/<game>/electron/build-main.ts`, and the scaffold template's copy of it)
 * that owns the paths, the module resolution and esbuild itself, and calls
 * {@link buildAppBundles} here. This mirrors
 * `@chimera-engine/electron/packaged-bundle`, which splits its gate the same way.
 *
 * The engine package imports nothing from `tools/` or any app (§3 dependency
 * direction): the app dir, root and game package name all arrive as parameters.
 *
 * esbuild is INJECTED, never imported. {@link EsbuildBundleOptions} is a
 * hand-written structural interface rather than `import type { BuildOptions }
 * from 'esbuild'`. That keeps `esbuild` out of this package's runtime AND type
 * surface, so `@chimera-engine/electron` gains no dependency from the move —
 * a property `electron/__tests__/no-esbuild-dependency.test.ts` ratchets,
 * because `verify:publish`'s depcheck reads emitted `.js` and a type-only import
 * erases before it looks.
 */

import path from 'node:path';

/**
 * Env var the `verify:pack` gate (tools/verify-pack.ts) sets to the throwaway
 * consumer's `node_modules`, flipping `@chimera-engine/*` resolution off the
 * workspace symlinks and onto the packed tarballs. Duplicated as a literal in
 * that gate (not imported) to keep it on node builtins only; both sides assert
 * it in tests.
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
 * constant-folds to the literal `false` in the emitted bundle, and so does the
 * character-identical copy of that expression that `electron/main/index.ts` uses
 * as its debug gate (see below for why it is a copy). Every reader of the flag is
 * therefore dead in a distributable: even if the startup guard were bypassed, no
 * debug surface can be registered. Asserted against a real bundle in the
 * reference app's `__tests__/packaged-bundle-content.test.ts` — packaged emits
 * `IS_DEBUG_MODE = false`; a dev build keeps the runtime reads.
 *
 * BOTH reads must be defined. Replacing only `NODE_ENV` leaves
 * `process.env.CHIMERA_DEBUG === '1' && false`, which esbuild cannot reduce to a
 * literal (the env read is not provably side-effect-free). Baking `CHIMERA_DEBUG`
 * to empty is exactly right semantically: a packaged build must never honour it
 * (Invariant #27).
 *
 * These same two defines are what let the debug graph LEAVE the bundle. The gate
 * in `electron/main/index.ts` does not test the imported `IS_DEBUG_MODE` — esbuild
 * does not propagate a cross-module constant into a consuming module, so that
 * form kept the branch live and shipped the graph. The gate inlines the identical
 * expression, which folds here to `if (false)`; esbuild then prunes the two
 * dynamic-import records behind it — around 30 KB, with the debug graph's marker
 * strings gone. It does NOT minify, so the dead branch statements themselves
 * remain (rewritten to `await null`).
 *
 * Absolute byte totals are deliberately not recorded here. They move with engine
 * dist churn and with the cwd the build ran in (esbuild embeds cwd-relative
 * module paths), so a pinned figure goes stale on unrelated changes and reads as
 * a regression. The stable, checkable claim is the ABSENCE of the markers,
 * which `verify:packaged-bundle` asserts against a real build.
 *
 * This does NOT blind the startup guard. The guard reads the flag as
 * `env['CHIMERA_DEBUG']` — bracket access on an injected `process.env`
 * reference, not a dot-access member expression — so `define` leaves it alone
 * and a packaged binary launched with `CHIMERA_DEBUG=1` still refuses to start.
 * Keys MUST stay dot-access; that is the only shape esbuild matches (invariant
 * Check 9 pins the constant's side of the same contract).
 *
 * Returns `{}` for everyday dev builds and for the e2e `global-setup`s, which
 * pass `process.env` without the flag: they share this plan, and baking
 * production there would silently disable the F9 Inspector.
 *
 * This is defence in depth, not the enforcement — the packaged-aware startup
 * guard (`electron/main/startup-guard.ts`) is what refuses to start.
 */
export function computePackagedDefine(
    env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
    return isPackagedBuild(env)
        ? { 'process.env.NODE_ENV': '"production"', 'process.env.CHIMERA_DEBUG': '""' }
        : {};
}

/**
 * Is this bundle destined for a distributable?
 *
 * The single reading of the packaging signal. Two independent decisions depend
 * on it — baking the production define, and dropping the debug preload — and
 * they must never disagree: a bundle with the define baked but the preload still
 * emitted (or vice versa) is a half-excluded artifact, the same failure mode this
 * file warns about for the two `define` keys.
 */
export function isPackagedBuild(env: Readonly<Record<string, string | undefined>>): boolean {
    return env[PACKAGED_BUILD_ENV] === '1';
}

/** The default plan's bundle labels. A closed set. */
export type PlannedBundleLabel = 'main' | 'preload' | 'debug-preload';

/**
 * Any bundle's label — the three above, or whatever an extra bundle
 * ({@link AppBundlePlanOverrides.extraBundles}) calls itself.
 *
 * The `& Record<never, never>` keeps the three literals in autocomplete while
 * still admitting an arbitrary string. It also means a typo in a `BundleSpec`
 * literal is NOT a type error — which is why every keyed option that could
 * silently no-op on one is keyed to {@link PlannedBundleLabel} instead, and why
 * an extra bundle carries its own settings on its own declaration rather than
 * being looked up by name.
 */
export type BundleLabel = PlannedBundleLabel | (string & Record<never, never>);

/** A single esbuild bundle to emit (main / preload / debug-preload / an extra). */
export interface BundleSpec {
    readonly label: BundleLabel;
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
 * The COMPLETE esbuild option set the shipped build passes, derived from a
 * {@link BundleSpec}. Sink options (`outfile`, `sourcemap`) are included
 * deliberately: an in-memory assertion overrides them with `write: false`, and
 * leaving them to the caller is what lets the guarded set drift.
 *
 * `define` is the sole link between {@link computePackagedDefine} and the
 * emitted bytes — Invariant #27 rests on it reaching esbuild. `sourcemap` is
 * load-bearing too, in a way it does not look: switched to `'inline'` it would
 * embed the original TypeScript — debug sources included — inside the shipped
 * `main.js`, where the external `.map` files never travel.
 *
 * Hand-written rather than `import type { BuildOptions } from 'esbuild'`: this
 * package must name no esbuild specifier in any position (see the file header).
 */
export interface EsbuildBundleOptions {
    entryPoints: string[];
    bundle: true;
    platform: 'node';
    format: 'cjs';
    target: 'node20';
    external: string[];
    alias: Record<string, string>;
    nodePaths: string[];
    define: Record<string, string>;
    outfile: string;
    /**
     * External `.map` files, so a debugger (a consumer's "Debug <Game>" launch
     * config, or `pnpm start:debug`) binds breakpoints in the original
     * TypeScript rather than the bundled output. Each app's
     * `electron-builder.yml` lists the shipped bundles by name, so no `.map`
     * reaches a distributable.
     */
    sourcemap: true;
}

/** @see EsbuildBundleOptions */
export function esbuildBundleOptions(spec: BundleSpec): EsbuildBundleOptions {
    return {
        entryPoints: [spec.entry],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: [...spec.external],
        alias: { ...spec.alias },
        nodePaths: [...spec.nodePaths],
        define: { ...spec.define },
        outfile: spec.outfile,
        sourcemap: true,
    };
}

/**
 * The {@link BuildFn} a driver's CLI ships, with esbuild and the FS injected.
 *
 * The point of the factory is that the packaged-bundle assertions can EXECUTE
 * the shipped invocation — passing a capturing `runBuild` — instead of asserting
 * about its source text. Were a driver to spell its own `buildSync({ ... })`
 * call, no scan of that literal could keep its option set honest: a second
 * spread (`...{ define: {} }`) reinstates any option past a check of declared
 * properties and reships the entire debug graph with every assertion green.
 * Options reached by a test only through a restatement — or through a denylist
 * of names — are not options the test actually guards.
 *
 * So `tools/packaged-build-flag.test.ts` enumerates no option names. It pins
 * one structural fact instead: esbuild is reached exactly once in each driver,
 * through this factory. This is also why the plan overrides below are
 * PLAN-shaped and never esbuild-shaped — an "extra esbuild options" hook
 * re-opens exactly the hole that ratchet closes.
 *
 * Two limits worth stating, because the arrangement looks more complete than it
 * is. Executing the factory guards an option only as far as the assertions can
 * SEE it: `define` is covered because dropping it puts marker strings back in
 * the text, whereas `sourcemap: 'inline'` would embed every source and leave the
 * markers base64-hidden, passing them all. And nothing here constrains what a
 * driver passes to {@link buildAppBundles} — a wrapped `build:` or a starved
 * `env:` defeats every unit-level guard in this file's orbit. Both classes are
 * caught instead by each consumer's `verify:packaged-bundle` gate, which reads
 * the bytes a real packaging run emits and models none of this.
 */
export function createEsbuildBuild(deps: {
    readonly runBuild: (options: EsbuildBundleOptions) => void;
    readonly ensureDir: (dir: string) => void;
}): BuildFn {
    return (spec) => {
        deps.ensureDir(path.dirname(spec.outfile));
        deps.runBuild(esbuildBundleOptions(spec));
    };
}

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
    /** @see AppBundlePlanOverrides.alias */
    readonly aliasOverrides?: Readonly<Record<string, string>>;
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
    if (options.aliasOverrides !== undefined) {
        Object.assign(alias, options.aliasOverrides);
        // The game's own package key is restored unconditionally. Everything else
        // here is an opinion an app may hold differently, but pointing
        // `@chimera-engine/<game>` anywhere other than the app's own source makes
        // `build:app` bundle a different game — silently, and only in a
        // distributable if the override arrived behind an env check.
        alias[options.gamePackageName] = options.appDir;
    }
    return alias;
}

export interface BundleOutfiles {
    readonly main: string;
    readonly preload: string;
    readonly debugPreload: string;
}

/**
 * The app's bundle output paths, derived from its dir.
 *
 * The two SHIPPED paths are fixed by files the engine cannot update: `main` is
 * each app's `package.json` `"main"`, and both it and `preload` are named
 * individually in its `electron-builder.yml` `files:` allowlist. `debugPreload`
 * is the opposite — it must never appear in that allowlist (the packaged-bundle
 * gate rejects a config that so much as mentions `debug-api`), and a packaged
 * build emits none; it is here because the plan needs a path for the dev/e2e
 * bundle and the gate needs one to assert nothing is at it.
 *
 * An app that needs a different layout passes its own map
 * (`BuildAppBundlesDeps.outfiles`) rather than changing this.
 */
export function appBundleOutfiles(appDir: string): BundleOutfiles {
    return {
        main: path.join(appDir, 'dist/electron/main.js'),
        preload: path.join(appDir, 'dist/preload/api.js'),
        debugPreload: path.join(appDir, 'dist/preload/debug-api.js'),
    };
}

/**
 * The host's Inspector-window debug preload SOURCE entry for the everyday dev
 * `build:app`, or `undefined` when it is absent. ONLY the engine monorepo carries
 * that source (`<root>/electron/preload/debug-api.ts`); a scaffolded game's driver
 * calls this too but has no host source, so `fileExists` returns false and the
 * debug bundle falls through to {@link resolveInstalledDebugPreloadEntry} —
 * matching `@chimera-engine/electron/preload/debug-api` being a private,
 * non-public export (Invariant #27). Without this the dev `build:app`
 * would emit only `api.js`, so a dev launch's F9 would open an Inspector window whose
 * preload bridge could not load (the e2e `global-setup` builds the same entry into
 * `.e2e-build`, so e2e wouldn't catch it).
 *
 * Resolution stays DRIVER-owned — this takes `root` and the probe as parameters
 * rather than reading `import.meta.url`. Self-resolution would collapse the very
 * signal the two routes discriminate on: from the workspace symlink the engine's
 * own `preload/debug-api.ts` always exists, so a debug-free consumer (the
 * scaffold's e2e global-setup) would start emitting a debug bundle.
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

/**
 * The adopter escape hatch: the parts of the plan an app may legitimately need
 * to change, expressed as PLAN facts rather than esbuild options.
 *
 * Most of what an app owns is already injected through
 * {@link BuildAppBundlesDeps} — the `build` function, `outfiles`, the preload
 * resolution, the debug-entry probe, the log sink. What is left, and what this
 * covers, is what the plan hardcodes: the main entry, the alias map, the
 * `external` lists, and the closed set of bundles it plans.
 *
 * There is deliberately NO hook that reaches esbuild's options. See
 * {@link createEsbuildBuild} for why a denylist over an option literal cannot be
 * completed, and why `sourcemap: true` in particular must not become
 * configurable.
 */
export interface AppBundlePlanOverrides {
    /** Main composition-root entry. Default `<appDir>/electron/main.ts`. */
    readonly mainEntry?: string;
    /**
     * Merged OVER the derived alias map. The app's own `@chimera-engine/<game>`
     * key is always restored afterwards — see {@link computeEsbuildAlias}.
     */
    readonly alias?: Readonly<Record<string, string>>;
    /**
     * Appended to a planned bundle's externals; never replaces them. `electron`
     * (and `node:*` for main) are not preferences — bundling either breaks the
     * emitted app — so a replacing hook would look like it worked right up to
     * the launch that failed. Entries the base list already carries are ignored.
     *
     * Keyed to {@link PlannedBundleLabel}, the CLOSED set, so a misspelt key is
     * a compile error rather than a silent no-op. An extra bundle carries its
     * own `external` on its own declaration for the same reason — nothing here
     * is looked up by a name the type system cannot check.
     */
    readonly external?: Readonly<Partial<Record<PlannedBundleLabel, readonly string[]>>>;
    /**
     * Extra bundles planned alongside main/preload/debug-preload — a
     * utility-process worker, a second preload. Each gets the shared alias,
     * nodePaths and define, externalises `electron`, and may append its own
     * `external` entries.
     *
     * An extra bundle that SHIPS must also be declared to the app's
     * `verify:packaged-bundle` gate (`VerifyPackagedBundleOptions.extraShipped`)
     * and listed in `electron-builder.yml` `files:` — the allowlist check
     * rejects any `dist/` entry that is not part of the declared plan.
     */
    readonly extraBundles?: readonly (Pick<BundleSpec, 'label' | 'entry' | 'outfile'> & {
        readonly external?: readonly string[];
    })[];
}

export interface PlanBundlesOptions extends AppBundlePlanOverrides {
    readonly appDir: string;
    readonly preloadEntry: string;
    /**
     * The Inspector-window debug preload entry. Absent ⇒ no debug bundle (the
     * portable production default; `@chimera-engine/electron/preload/debug-api` is not a
     * public export — Invariant #27 — so only a build with the host source, or the
     * packed-sibling fallback, supplies it).
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
     * ({@link appBundleOutfiles}). The E2E `global-setup`s pass their `.e2e-build`
     * layout so production and tests share one plan with different sinks.
     */
    readonly outfiles?: BundleOutfiles;
}

/** Base externals plus any the caller appends, without duplicates. */
function externalsWith(base: readonly string[], extra: readonly string[] = []): string[] {
    return [...base, ...extra.filter((entry) => !base.includes(entry))];
}

/**
 * The deterministic bundle plan. Main externalises `electron` + `node:*` (Node main
 * context); the preload(s) run in a sandboxed renderer with only `electron` external.
 */
export function planBundles(options: PlanBundlesOptions): BundleSpec[] {
    const out = options.outfiles ?? appBundleOutfiles(options.appDir);
    const define = options.define ?? {};
    const shared = {
        alias: options.alias,
        nodePaths: options.nodePaths,
        define,
    };
    const specs: BundleSpec[] = [
        {
            label: 'main',
            entry: options.mainEntry ?? path.join(options.appDir, 'electron/main.ts'),
            outfile: out.main,
            external: externalsWith(['electron', 'node:*'], options.external?.main),
            ...shared,
        },
        {
            label: 'preload',
            entry: options.preloadEntry,
            outfile: out.preload,
            external: externalsWith(['electron'], options.external?.preload),
            ...shared,
        },
    ];
    if (options.debugPreloadEntry !== undefined) {
        specs.push({
            label: 'debug-preload',
            entry: options.debugPreloadEntry,
            outfile: out.debugPreload,
            external: externalsWith(['electron'], options.external?.['debug-preload']),
            ...shared,
        });
    }
    for (const extra of options.extraBundles ?? []) {
        specs.push({
            label: extra.label,
            entry: extra.entry,
            outfile: extra.outfile,
            external: externalsWith(['electron'], extra.external),
            ...shared,
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
    /** Optional host-SOURCE debug preload entry; see {@link PlanBundlesOptions}. */
    readonly debugPreloadEntry?: string;
    /**
     * Existence probe (an injected `existsSync`) for the STANDALONE debug-preload fallback: when no
     * source `debugPreloadEntry` is supplied, resolve the packed engine's compiled
     * `debug-api.js` sibling of the api preload. Supplied only by a driver's `build:app` CLI entry;
     * absent from the e2e global-setups, which stay debug-free. Keeps the fallback unit-testable.
     */
    readonly fileExists?: (file: string) => boolean;
    /** Optional output-path override (the E2E `.e2e-build` layout); see {@link PlanBundlesOptions}. */
    readonly outfiles?: BundleOutfiles;
    /** The app's plan-shaped escape hatch. @see AppBundlePlanOverrides */
    readonly overrides?: AppBundlePlanOverrides;
    /** Progress sink. The plan itself never calls `console.*`. */
    readonly log?: (message: string) => void;
}

/**
 * Derive the alias from the app's own package name, resolve the preload entry,
 * plan the bundles, and emit each through the injected `build`. The single runtime
 * entry point every consumer's `build:app` and E2E `global-setup` drive.
 */
export function buildAppBundles(deps: BuildAppBundlesDeps): void {
    const pkg = deps.readJson(path.join(deps.appDir, 'package.json'));
    if (pkg.name === undefined) {
        throw new Error(`build:app: ${deps.appDir}/package.json is missing a "name"`);
    }
    const overrides = deps.overrides ?? {};

    const alias = computeEsbuildAlias(deps.env, {
        root: deps.root,
        appDir: deps.appDir,
        gamePackageName: pkg.name,
        ...(overrides.alias !== undefined ? { aliasOverrides: overrides.alias } : {}),
    });
    // Resolve nodePaths to ABSOLUTE against the app dir. A standalone app's scripts inject a
    // RELATIVE `CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules` (the only value a portable npm
    // script can set), but both esbuild's nodePaths and resolvePreload's `createRequire` need an
    // absolute path. Absolute values (the verify:pack / verify:scaffold gates) pass through
    // path.resolve unchanged, so this is backward-compatible.
    const nodePaths = computeNodePaths(deps.env).map((entry) => path.resolve(deps.appDir, entry));
    const verifyPackMode = nodePaths.length > 0;

    const preloadEntry = deps.resolvePreload(verifyPackMode ? nodePaths[0] : undefined);

    // The SOURCE debug entry is never used in verify:pack mode (the gate excludes the
    // debug specs; the source is private). PRESERVED verbatim as the source-entry branch.
    const sourceDebugPreloadEntry = verifyPackMode ? undefined : deps.debugPreloadEntry;
    // STANDALONE FALLBACK: a scaffolded game supplies NO source entry AND its build:app always runs
    // in verify:pack mode (CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules, to resolve the engine from
    // node_modules) — which would drop the debug bundle and break F9. When (and only when) no source
    // entry was supplied, resolve the debug preload as the SIBLING of the resolved api preload (the
    // packed engine ships dist/preload/debug-api.js). Monorepo + e2e keep their exact behaviour: a
    // supplied source entry always takes the preserved verify:pack drop above. Optional keys are
    // spread in only when defined (exactOptionalPropertyTypes forbids explicit undefined).
    const resolvedDebugPreloadEntry =
        deps.debugPreloadEntry === undefined
            ? resolveInstalledDebugPreloadEntry(preloadEntry, deps.fileExists)
            : sourceDebugPreloadEntry;
    // A PACKAGED build EMITS no debug preload at all. `dist/preload/debug-api.js` is the largest
    // debug artifact on disk (~532 KB + a ~1.06 MB sourcemap) and it is unreachable even when
    // present: the only thing that loads it is the Inspector window, created from behind the debug
    // gate that `computePackagedDefine` folds dead. electron-builder's `files` allowlist already
    // keeps it out of the packaged app, so this is not a shipped-byte saving — it keeps the artifact
    // out of the build tree, and out of any distributable whose `files` list is later widened to
    // `dist/**`. Applied to the RESOLVED entry so it suppresses BOTH routes above — in particular
    // the packed-sibling fallback, which is the one a scaffolded game's packaging run takes (it
    // always builds in verify:pack mode).
    const debugPreloadEntry = isPackagedBuild(deps.env) ? undefined : resolvedDebugPreloadEntry;
    const specs = planBundles({
        ...overrides,
        appDir: deps.appDir,
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
