import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildSync } from 'esbuild';

import { buildAppBundles, type BundleOutfiles } from '../electron/build-main';
import { E2E_USER_DATA_ROOT } from './fixtures/user-data-root';

/**
 * The build root this suite owns, as a bare directory name.
 *
 * Its OWN, not the tactics suite's `.e2e-build`: both setups delete their whole
 * root on every run, so one shared root would mean whichever suite started last
 * deleted the other's bundles out from under a running app.
 */
export const ACTION_E2E_BUILD_DIR_NAME = '.e2e-build-action';

/** Where this suite's Electron bundles are written, given the repo root. */
export function resolveActionE2eBuildRoot(root: string): string {
    return path.join(root, ACTION_E2E_BUILD_DIR_NAME);
}

/**
 * The e2e launch layout: main is nested one level deeper than production
 * (`electron/main/index.js` vs `dist/electron/main.js`) so the host's
 * `<mainDir>/../preload/api.js` resolution still lands on the sibling preload.
 *
 * `debugPreload` is required by the bundler's outfile type and never written:
 * this suite launches no debug-mode app — its fixture strips `CHIMERA_DEBUG` —
 * so there is no Inspector window for a debug preload to serve.
 */
export function resolveActionE2eOutfiles(e2eBuildRoot: string): BundleOutfiles {
    return {
        main: path.join(e2eBuildRoot, 'electron', 'main', 'index.js'),
        preload: path.join(e2eBuildRoot, 'electron', 'preload', 'api.js'),
        debugPreload: path.join(e2eBuildRoot, 'electron', 'preload', 'debug-api.js'),
    };
}

/**
 * The static-export entry the launch fixture points `CHIMERA_E2E_RENDERER_ENTRY`
 * at — the ACTION app's own Next host output, never the root renderer's and
 * never another app's.
 */
export function resolveActionRendererEntry(root: string): string {
    return path.join(root, 'apps', 'action', 'renderer', 'out', 'index.html');
}

/** Source → destination dir pair for the e2e app-asset copy. */
export interface E2eAssetCopy {
    readonly from: string;
    readonly to: string;
}

/**
 * The default-app-icon asset copy the E2E build must perform.
 *
 * The bundled main lands at `<e2eBuildRoot>/electron/main/index.js`, and the
 * host's `resolveAppIcon` falls back to `<mainDir>/../../assets/icons/chimera.png`
 * when a game declares no icon override — which the action manifest does not.
 * Production ships `electron/assets/` beside `dist/` via electron-builder, but
 * the e2e layout has no packager, so this mirrors the host package's in-tree
 * `electron/assets/` into it. Without the copy the default icon 404s and
 * `app.dock.setIcon` throws mid-`createMainWindow`, so the window never opens
 * and every spec times out at `firstWindow`.
 */
export function resolveActionE2eAssetCopy(root: string, e2eBuildRoot: string): E2eAssetCopy {
    return {
        from: path.join(root, 'electron', 'assets'),
        to: path.join(e2eBuildRoot, 'assets'),
    };
}

/**
 * Playwright global setup for the ACTION suite — runs once before all its tests.
 *  1. Builds the engine packages, then this app's OWN Next host
 *     (`apps/action/renderer` → `apps/action/renderer/out`).
 *  2. Bundles the Electron main + host preload through {@link buildAppBundles} —
 *     the SAME plan `build:app` runs in production, reached through this app's
 *     own `electron/build-main.ts` driver — into the layout above.
 *
 * The import goes through `../electron/build-main` rather than straight to
 * `@chimera-engine/electron/build-main` so this app has ONE door into the bundle
 * plan: the same one `build:app` uses, so a customisation made there reaches
 * the suite for free.
 *
 * No debug preload is bundled: this suite runs no Inspector spec, and the
 * fixture strips `CHIMERA_DEBUG` from the launched environment.
 */
export default function globalSetup(): void {
    // apps/action/e2e → app dir is one up, repo root three up.
    const appDir = path.resolve(__dirname, '..');
    const root = path.resolve(appDir, '..', '..');
    const e2eBuildRoot = resolveActionE2eBuildRoot(root);

    rmSync(e2eBuildRoot, { recursive: true, force: true });

    // Every launch mints a fresh Chromium profile under this root and NOTHING
    // removes it afterwards. Reaped per run instead, here, beside the suite's
    // other throwaway tree; left alone the root grows by one whole Chromium user
    // directory per launch until it fills the volume.
    //
    // The reap must never remove a directory a LIVE app owns. Within a run that
    // holds: this runs in the runner process before any worker spawns, and the
    // lazy `ensureE2eBuild` path that also calls it only fires when the bundles
    // are missing, which already means no app of this run is running. It does
    // NOT hold across two runs of THIS suite sharing one temp dir — run them one
    // at a time. The tactics suite reaps a different root and cannot reach this
    // one.
    rmSync(E2E_USER_DATA_ROOT, { recursive: true, force: true });

    execSync('pnpm build:packages', { cwd: root, stdio: 'inherit' });
    execSync('pnpm exec next build apps/action/renderer', {
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
                // Honour the spec's define like the `build:app` CLI does. Empty
                // in practice here (e2e never sets CHIMERA_PACKAGED_BUILD),
                // forwarded so the BundleSpec contract has no silent exception.
                define: { ...spec.define },
            });
        },
        readJson: (file) => JSON.parse(readFileSync(file, 'utf8')) as { name?: string },
        // Resolved through `@chimera-engine/electron`'s package `exports`, the
        // way a consumer reaches it — mirroring the app's own `build:app` CLI.
        //
        // The injected `nodeModules` argument is deliberately ignored, unlike in
        // the tactics setup and the scaffold template. That argument is
        // `verify:pack` mode, which resolves the preload out of a throwaway
        // tarball install instead of the workspace — and `verify:pack` runs the
        // TACTICS config only (`tools/verify-pack.ts` spells that path). Honouring
        // it here would add a branch no run of this suite can reach, which is a
        // branch nothing can hold honest.
        resolvePreload: () =>
            createRequire(path.join(appDir, 'package.json')).resolve(
                '@chimera-engine/electron/preload/api',
            ),
        env: process.env,
        root,
        appDir,
        outfiles: resolveActionE2eOutfiles(e2eBuildRoot),
    });

    // Mirror the host package's app icons into the layout so the bundled main's
    // default-icon resolution lands on a real file. See resolveActionE2eAssetCopy.
    const assets = resolveActionE2eAssetCopy(root, e2eBuildRoot);
    cpSync(assets.from, assets.to, { recursive: true });
}
