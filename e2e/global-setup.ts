import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'path';
import { buildSync } from 'esbuild';

/**
 * Playwright global setup — runs once before all E2E tests.
 * 1. Compiles the renderer bundle so tests can load the real UI.
 * 2. Bundles electron/main/index.ts → .e2e-build/electron/main/index.js  (main process)
 * 3. Bundles electron/preload/api.ts → .e2e-build/electron/preload/api.js (preload script)
 * 4. Bundles electron/preload/debug-api.ts → .e2e-build/electron/preload/debug-api.js
 *    (Inspector window preload — the debug bridge resolves it as a sibling of
 *    the main preload, so debug-mode specs need it next to api.js)
 *
 * @chimera/* path aliases are resolved here to real workspace-relative paths
 * because the Electron process itself has no tsconfig-paths support at runtime.
 */
export default function globalSetup(): void {
    const root = path.resolve(__dirname, '..');
    const e2eBuildRoot = path.join(root, '.e2e-build');
    const mainOutfile = path.join(e2eBuildRoot, 'electron', 'main', 'index.js');
    const preloadOutfile = path.join(e2eBuildRoot, 'electron', 'preload', 'api.js');

    rmSync(e2eBuildRoot, { recursive: true, force: true });
    mkdirSync(path.dirname(mainOutfile), { recursive: true });
    mkdirSync(path.dirname(preloadOutfile), { recursive: true });

    execSync('pnpm build:renderer', {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, NEXT_PUBLIC_CHIMERA_E2E: '1' },
    });

    // `@chimera/simulation`, `@chimera/ai`, and `@chimera/networking` are
    // intentionally absent: each is a built package (issues #759, #764, #768)
    // that esbuild resolves through its `exports` map onto `<pkg>/dist`
    // (build-before-consume; `pnpm build:packages` runs first in `test:e2e`).
    const alias: Record<string, string> = {
        '@chimera/electron': path.join(root, 'electron'),
        '@chimera/renderer': path.join(root, 'renderer'),
        '@chimera/tactics': path.join(root, 'games/tactics'),
    };

    // Main process — runs in Node.js (Electron's main context).
    buildSync({
        entryPoints: [path.join(root, 'electron/main/index.ts')],
        outfile: mainOutfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['electron', 'node:*'],
        alias,
    });

    // Preload script — runs in a sandboxed renderer context but has access to
    // Node.js APIs via contextBridge; bundle as CJS with Electron as external.
    buildSync({
        entryPoints: [path.join(root, 'electron/preload/api.ts')],
        outfile: preloadOutfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['electron'],
        alias,
    });

    // Inspector window preload — the debug bridge (electron/main/debug-bridge.ts)
    // loads it from path.dirname(<main preload>)/debug-api.js, so it must sit
    // next to api.js for debug-mode (CHIMERA_DEBUG=1) launches.
    buildSync({
        entryPoints: [path.join(root, 'electron/preload/debug-api.ts')],
        outfile: path.join(path.dirname(preloadOutfile), 'debug-api.js'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['electron'],
        alias,
    });
}
