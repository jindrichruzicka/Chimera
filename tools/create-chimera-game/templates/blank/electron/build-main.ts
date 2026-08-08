// This game's `build:app` DRIVER — the thin, game-owned half of the Electron
// bundler. It bundles this app's Electron MAIN composition root
// (`electron/main.ts`, which constructs this game's `MainGameContribution` and
// calls the host `@chimera-engine/electron/main`'s `main()`) AND the host
// PRELOAD (`@chimera-engine/electron/preload/api`) into single runnable CJS
// files under this app's own `dist/`:
//
//   electron/main.ts                       → dist/electron/main.js   (package.json "main")
//   @chimera-engine/electron/preload/api   → dist/preload/api.js     (the sibling the host
//                                            resolves at runtime: <main>/../preload/api.js)
//
// THIS FILE IS YOURS TO EDIT. What is NOT here is the bundle PLAN — the
// production `define` that folds the engine's debug gate dead, the esbuild
// alias derivation, the output layout and the list of bundles. That lives in
// `@chimera-engine/electron/build-main`, in the engine package you installed,
// so a fix there reaches this game with an engine upgrade instead of a manual
// merge. Everything the plan cannot know is here: this app's paths, its module
// resolution, and esbuild itself.
//
// If you need to change the plan rather than the paths, prefer the plan-shaped
// hooks the engine exposes (`overrides` on `buildAppBundles`: the main entry,
// extra aliases, extra externals, extra bundles) over rewriting this file's
// esbuild call. The engine deliberately exposes no hook that reaches esbuild's
// options directly: `sourcemap` in particular must stay EXTERNAL, because
// `'inline'` embeds your whole TypeScript source — engine debug sources
// included — inside the `main.js` that actually ships, where the separate
// `.map` files never travel.
//
// Two more constraints worth knowing before you edit:
//
//  - esbuild must be reached only through `createEsbuildBuild`, never as a
//    hand-spelled `buildSync({ … })` call here. The factory is what makes the
//    option set testable at all: it can be executed with esbuild swapped for a
//    capture, whereas an option literal written at this call site can only be
//    read as text — and no scan of such a literal can be kept honest, because a
//    second spread reinstates any option past a check of the declared ones.
//    Drop the `define` there and your distributable silently reships the
//    engine's Inspector graph.
//  - `pnpm verify:packaged-bundle` is what actually catches that, in YOUR
//    project: it reads the bytes a real packaging build emits, so no refactor of
//    this file can satisfy it while the debug layer ships. Run it after editing.
//
// The re-export block below is load-bearing, not a convenience: this app's E2E
// `global-setup` and its `verify:packaged-bundle` gate reach the plan THROUGH
// this file. Keep it if you keep those.

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

import {
    PACKAGED_BUILD_ENV,
    VERIFY_PACK_NODE_MODULES_ENV,
    appBundleOutfiles,
    buildAppBundles,
    createEsbuildBuild,
    resolveDevDebugPreloadEntry,
    type BuildFn,
    type BundleOutfiles,
    type BundleSpec,
    type EsbuildBundleOptions,
} from '@chimera-engine/electron/build-main';

export {
    PACKAGED_BUILD_ENV,
    VERIFY_PACK_NODE_MODULES_ENV,
    appBundleOutfiles,
    buildAppBundles,
    createEsbuildBuild,
    resolveDevDebugPreloadEntry,
    type BuildFn,
    type BundleOutfiles,
    type BundleSpec,
    type EsbuildBundleOptions,
};

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────
//
// Runs only when this module is executed DIRECTLY via `tsx electron/build-main.ts`
// (this app's `build:app` script) — never when imported (the E2E `global-setup`
// imports `buildAppBundles`/helpers, and must not trigger a build on import). The
// `VITEST` guard additionally keeps esbuild + disk I/O out of the unit surface.
// CJS `__dirname`/`__filename` (not `import.meta`) keep the file loadable by both
// tsx and the Playwright transform that bundles global-setup (a stray
// `import.meta` makes the latter emit a CJS/ESM mismatch).

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

    // No esbuild options here by construction: every one of them comes from the
    // engine's `esbuildBundleOptions`, which the packaged-build assertions
    // execute. A hand-spelled `buildSync({ … })` call here could not be kept
    // honest by any scan of its option literal.
    const build = createEsbuildBuild({
        runBuild: buildSync,
        ensureDir: (dir) => mkdirSync(dir, { recursive: true }),
    });

    const resolvePreload = (nodeModules?: string): string => {
        // From an external consumer's package.json or this app's own — both
        // resolve `@chimera-engine/electron/preload/api` through the package `exports` map.
        const fromPackageJson =
            nodeModules !== undefined
                ? path.join(path.dirname(nodeModules), 'package.json')
                : path.join(appDir, 'package.json');
        return createRequire(fromPackageJson).resolve('@chimera-engine/electron/preload/api');
    };

    // Bundle the Inspector-window debug preload, the one that makes F9 work in a dev launch.
    // Two signals decide where it comes from, and both are supplied HERE rather than resolved
    // inside the engine: `resolveDevDebugPreloadEntry` looks for an engine SOURCE tree, and the
    // injected `fileExists` probe finds the compiled `debug-api.js` that an installed
    // `@chimera-engine/electron` ships beside its api preload. A self-resolving plan would always
    // find the engine's own copy and emit a debug bundle even for builds that deliberately want
    // none. A packaged build emits neither. Spread the source entry in only when defined —
    // exactOptionalPropertyTypes forbids an explicit `undefined`.
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
