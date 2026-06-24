import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'path';
import { buildSync } from 'esbuild';

/**
 * Playwright global setup — runs once before all E2E tests.
 * 1. Compiles the renderer bundle so tests can load the real UI.
 * 2. Bundles apps/tactics/electron/main.ts → .e2e-build/electron/main/index.js
 *    (main process: the consumer app's composition root that injects the game and
 *    calls the host's main())
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

    // `@chimera/simulation`, `@chimera/ai`, `@chimera/networking`, and
    // `@chimera/renderer` are intentionally absent: each is a built package
    // (issues #759, #764, #768, #773) that esbuild resolves through its `exports`
    // map onto `<pkg>/dist` (build-before-consume; `pnpm build:packages` runs
    // first in `test:e2e`). The preload entry points are compiled from their own
    // source by path and import their package-internal modules relatively.
    // `@chimera/tactics` lives at apps/tactics (relocated in F63 #782); its dist/
    // is built but not yet consumed, so it keeps its source alias. F64 flips this
    // onto its exports map. `@chimera/electron/main` is aliased onto SOURCE (#778): the
    // main entry is now the consumer app's composition root
    // `apps/tactics/electron/main.ts` (relocated from app/ in F63/#783), which imports
    // the host as a consumer would (`@chimera/electron/main`); aliasing it to
    // source keeps the bundle compiling the host from current source rather than
    // its (non-launchable) `dist/` ESM build — the F62/T2→T3 launch story.
    const alias: Record<string, string> = {
        '@chimera/tactics': path.join(root, 'apps/tactics'),
        '@chimera/electron/main': path.join(root, 'electron/main/index.ts'),
    };

    // Main process — runs in Node.js (Electron's main context). Entry is the
    // consumer app's composition root apps/tactics/electron/main.ts (injects the
    // tactics contribution and calls the host's main()); it still outputs to the
    // same path the launch fixture loads.
    buildSync({
        entryPoints: [path.join(root, 'apps/tactics/electron/main.ts')],
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
