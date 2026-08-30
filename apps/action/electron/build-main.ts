// apps/action/electron/build-main.ts
//
// This app's `build:app` DRIVER — the thin, app-owned half of the Electron
// bundler. It bundles this app's Electron MAIN composition root
// (`electron/main.ts`, which constructs the game's `MainGameContribution` and
// calls the host `@chimera-engine/electron/main`'s `main()`) AND the host
// PRELOAD (`@chimera-engine/electron/preload/api`) into single runnable CJS
// files under the app's own `dist/`:
//
//   electron/main.ts                       → dist/electron/main.js   (package.json "main")
//   @chimera-engine/electron/preload/api   → dist/preload/api.js     (the sibling the host
//                                            resolves at runtime: <main>/../preload/api.js)
//
// The PLAN — the packaging `define` Invariant #27 rests on, the esbuild alias /
// nodePaths derivation, the output layout and the bundle list — lives in the
// engine at `@chimera-engine/electron/build-main` (§3, §4.12), where a fix
// reaches every consumer app including scaffolded games. This file owns only
// what the engine must not: the app's own paths, its module resolution, and
// esbuild itself. `@chimera-engine/electron/packaged-bundle` splits the same
// way; this repo's driver for it is `tools/verify-packaged-bundle.ts`, which
// takes the plan from the engine directly rather than through this file (§3
// keeps `tools/` off an `apps/` import).
//
// esbuild stays HERE deliberately. The engine plan names no esbuild specifier in
// any position — `EsbuildBundleOptions` is a hand-written structural interface —
// so `@chimera-engine/electron` gains no dependency from owning the plan
// (`electron/__tests__/no-esbuild-dependency.test.ts` ratchets that).
//
// The re-export block below exists so this file is the app's ONE door into the
// plan: the app-level gates take the same door `build:app` does, rather than each
// reaching the engine on its own terms. `tools/packaged-build-flag.test.ts`
// derives the required surface from those consumers' own import lists, so the
// block cannot fall behind what they take.

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
// (the app's `build:app` script) — never when imported (the packaged-bundle gate
// imports `appBundleOutfiles`/`PACKAGED_BUILD_ENV`, and must not trigger a build
// on import). The
// `VITEST` guard additionally keeps esbuild + disk I/O out of the unit surface,
// matching tools/verify-pack.ts. CJS `__dirname`/`__filename` (not `import.meta`)
// keep the file loadable by both tsx and the Playwright transform an e2e
// global-setup is bundled by (a stray `import.meta` makes the latter emit a
// CJS/ESM mismatch).

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
    // engine's `esbuildBundleOptions`, which the packaged-bundle assertions
    // execute. A hand-spelled `buildSync({ … })` call here could not be kept
    // honest by any scan of its option literal.
    const build = createEsbuildBuild({
        runBuild: buildSync,
        ensureDir: (dir) => mkdirSync(dir, { recursive: true }),
    });

    const resolvePreload = (nodeModules?: string): string => {
        // From the consumer's package.json (verify:pack) or the app's own — both
        // resolve `@chimera-engine/electron/preload/api` through the package `exports` map.
        const fromPackageJson =
            nodeModules !== undefined
                ? path.join(path.dirname(nodeModules), 'package.json')
                : path.join(appDir, 'package.json');
        return createRequire(fromPackageJson).resolve('@chimera-engine/electron/preload/api');
    };

    // Bundle the Inspector-window debug preload. Two signals decide where it comes from —
    // `resolveDevDebugPreloadEntry`'s lookup for a host SOURCE tree under `root`, and the injected
    // `fileExists` probe for the compiled `debug-api.js` sibling of the resolved api preload — and
    // both are supplied HERE rather than resolved inside the engine: from the workspace symlink the
    // engine's own `preload/debug-api.ts` always exists, so a self-resolving plan would emit a debug
    // bundle for consumers that deliberately want none. Spread the source entry in only when defined
    // — exactOptionalPropertyTypes forbids explicit `undefined`.
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
