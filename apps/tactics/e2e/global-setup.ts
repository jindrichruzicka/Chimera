import { execSync } from 'child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'path';
import { buildSync } from 'esbuild';

import { buildAppBundles, VERIFY_PACK_NODE_MODULES_ENV } from '../electron/build-main';

/**
 * Re-exported for the e2e side's drift guard (global-setup.test.ts): the literal
 * MUST equal the one `tools/verify-pack.ts` passes. Its single declaration lives in
 * the app-owned bundler (`apps/tactics/electron/build-main.ts`); both `build:app`
 * and this setup share it, so the esbuild alias / nodePaths logic cannot drift.
 */
export { VERIFY_PACK_NODE_MODULES_ENV };

/**
 * Playwright global setup — runs once before all E2E tests.
 *  1. Compiles the renderer bundle so tests can load the real UI.
 *  2. Bundles the Electron main + host preload (+ Inspector debug preload) via the
 *     app-owned {@link buildAppBundles} — the SAME bundler `build:app` runs in
 *     production — into the `.e2e-build/` layout the launch fixture loads.
 *
 * `@chimera/*` path aliases are resolved by `buildAppBundles` (the Electron process
 * has no tsconfig-paths support at runtime). In `verify:pack` mode
 * (`CHIMERA_VERIFY_PACK_NODE_MODULES` set) it resolves the host + preload from the
 * packed tarballs instead of source, validating the real artifact end-to-end; the
 * debug preload is skipped (the gate excludes the debug specs; #27 keeps it private).
 */
export default function globalSetup(): void {
    // apps/tactics/e2e → app dir is one up, repo root three up (suite relocated under
    // the tactics consumer app in F63 #785). .e2e-build stays at the repo root.
    const appDir = path.resolve(__dirname, '..');
    const root = path.resolve(appDir, '..', '..');
    const e2eBuildRoot = path.join(root, '.e2e-build');

    // The e2e launch layout: main is nested one level deeper than production
    // (electron/main/index.js vs dist/electron/main.js) so the host's
    // `<mainDir>/../preload/api.js` resolution still lands on the sibling preload.
    const outfiles = {
        main: path.join(e2eBuildRoot, 'electron', 'main', 'index.js'),
        preload: path.join(e2eBuildRoot, 'electron', 'preload', 'api.js'),
        debugPreload: path.join(e2eBuildRoot, 'electron', 'preload', 'debug-api.js'),
    };

    rmSync(e2eBuildRoot, { recursive: true, force: true });

    execSync('pnpm build:renderer', {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, NEXT_PUBLIC_CHIMERA_E2E: '1' },
    });

    buildAppBundles({
        build: (spec) => {
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
        },
        readJson: (file) => JSON.parse(readFileSync(file, 'utf8')) as { name?: string },
        // Everyday suite: bundle the preload from host SOURCE (unchanged). verify:pack
        // mode: resolve it from the throwaway tarball's `@chimera/electron` export.
        resolvePreload: (nodeModules) =>
            nodeModules !== undefined
                ? createRequire(path.join(path.dirname(nodeModules), 'package.json')).resolve(
                      '@chimera/electron/preload/api',
                  )
                : path.join(root, 'electron/preload/api.ts'),
        env: process.env,
        root,
        appDir,
        outfiles,
        // Inspector-window preload — built from host source for debug-mode launches;
        // automatically skipped in verify:pack mode by buildAppBundles.
        debugPreloadEntry: path.join(root, 'electron/preload/debug-api.ts'),
    });
}
