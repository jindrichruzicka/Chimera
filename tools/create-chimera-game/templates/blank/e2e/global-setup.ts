import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildSync } from 'esbuild';

import { buildAppBundles } from '../electron/build-main';

/**
 * Playwright global setup — runs once before all E2E tests.
 *  1. Builds the engine packages, then this app's OWN Next host
 *     (apps/<game>/renderer → apps/<game>/renderer/out), which the launch fixture
 *     points CHIMERA_E2E_RENDERER_ENTRY at.
 *  2. Bundles the Electron main + host preload via the app-owned {@link buildAppBundles}
 *     — the SAME bundler `build:app` runs in production — into the `.e2e-build/` layout
 *     the launch fixture loads.
 *
 * `@chimera/*` path aliases are resolved by `buildAppBundles` (the Electron process has
 * no tsconfig-paths support at runtime). The preload is resolved from `@chimera/electron`'s
 * package `exports` (the way a consumer reaches it), mirroring the app's own
 * `electron/build-main.ts` CLI. No debug preload is bundled: `@chimera/electron/preload/debug-api`
 * is not a public export (Invariant #27).
 */
export default function globalSetup(): void {
    // apps/<game>/e2e → app dir is one up, repo root two up. .e2e-build stays at the repo root.
    const appDir = path.resolve(__dirname, '..');
    const root = path.resolve(appDir, '..', '..');
    const e2eBuildRoot = path.join(root, '.e2e-build');

    // The e2e launch layout: main is nested one level deeper than production
    // (electron/main/index.js vs dist/electron/main.js) so the host's
    // `<mainDir>/../preload/api.js` resolution still lands on the sibling preload.
    const outfiles = {
        main: path.join(e2eBuildRoot, 'electron', 'main', 'index.js'),
        preload: path.join(e2eBuildRoot, 'electron', 'preload', 'api.js'),
        // Required by the bundler's outfile type; never written (no debug bundle here).
        debugPreload: path.join(e2eBuildRoot, 'electron', 'preload', 'debug-api.js'),
    };

    rmSync(e2eBuildRoot, { recursive: true, force: true });

    execSync('pnpm build:packages', { cwd: root, stdio: 'inherit' });
    execSync('pnpm exec next build apps/__game_kebab__/renderer', {
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
        // Resolve the host preload through `@chimera/electron`'s package `exports`: from the
        // throwaway tarball install in verify:pack mode, otherwise from this app's own deps.
        resolvePreload: (nodeModules) => {
            const fromPackageJson =
                nodeModules !== undefined
                    ? path.join(path.dirname(nodeModules), 'package.json')
                    : path.join(appDir, 'package.json');
            return createRequire(fromPackageJson).resolve('@chimera/electron/preload/api');
        },
        env: process.env,
        root,
        appDir,
        outfiles,
    });
}
