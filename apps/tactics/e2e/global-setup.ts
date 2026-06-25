import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'path';
import { buildSync } from 'esbuild';

/**
 * Env var the `verify:pack` gate (tools/verify-pack.ts) sets to the throwaway
 * consumer's `node_modules` so this setup resolves every `@chimera/*` from the
 * packed tarballs instead of the workspace symlinks. (Duplicated as a literal
 * rather than imported, to keep the e2e suite off the `tools/` import boundary;
 * both sides assert the literal in their unit tests so it cannot drift.)
 */
export const VERIFY_PACK_NODE_MODULES_ENV = 'CHIMERA_VERIFY_PACK_NODE_MODULES';

/**
 * esbuild `nodePaths` for `@chimera/*` resolution: the throwaway tarball
 * `node_modules` in `verify:pack` mode, otherwise empty (esbuild falls back to the
 * workspace symlinks, the everyday path).
 */
export function computeNodePaths(env: Readonly<Record<string, string | undefined>>): string[] {
    const nodeModules = env[VERIFY_PACK_NODE_MODULES_ENV];
    return nodeModules !== undefined && nodeModules.length > 0 ? [nodeModules] : [];
}

/**
 * esbuild `@chimera/*` alias map for the Electron main + preload bundles.
 *
 * `@chimera/tactics` always resolves to the consumer app source (it is the game,
 * not a packed engine artifact). `@chimera/electron/main` is aliased onto host
 * SOURCE for the normal suite (#778: the main entry is the consumer's composition
 * root, which imports the host as a consumer would). In `verify:pack` mode that
 * alias is DROPPED so the host resolves from the packed `@chimera/electron` tarball
 * — validating the real artifact end-to-end.
 */
export function computeEsbuildAlias(
    env: Readonly<Record<string, string | undefined>>,
    root: string,
): Record<string, string> {
    const alias: Record<string, string> = {
        '@chimera/tactics': path.join(root, 'apps/tactics'),
    };
    if (computeNodePaths(env).length === 0) {
        alias['@chimera/electron/main'] = path.join(root, 'electron/main/index.ts');
    }
    return alias;
}

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
    // apps/tactics/e2e → repo root is three levels up (suite relocated under the
    // tactics consumer app in F63 #785). .e2e-build stays at the repo root.
    const root = path.resolve(__dirname, '../../..');
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
    // `@chimera/renderer` are intentionally absent from the alias map: each is a
    // built package (issues #759, #764, #768, #773) that esbuild resolves through
    // its `exports` map onto `<pkg>/dist`. In the normal suite that resolution
    // follows the workspace `workspace:*` symlinks (build-before-consume;
    // `pnpm build:packages` runs first in `test:e2e`); in `verify:pack` mode
    // `nodePaths` redirects it onto the throwaway TARBALL install instead, so the
    // bundle is compiled against the REAL packaged artifact (see computeNodePaths /
    // computeEsbuildAlias). `@chimera/tactics` keeps its source alias (it is the
    // consumer game, not a packed engine artifact). `@chimera/electron/main` is
    // aliased onto SOURCE for the normal suite (#778: the main entry is the consumer
    // app's composition root `apps/tactics/electron/main.ts`, which imports the host
    // as a consumer would); `verify:pack` mode DROPS that alias so the host resolves
    // from the packed `@chimera/electron` tarball — esbuild transpiles its ESM `dist`
    // to CJS during bundling, sidestepping the F62/T3 raw-launch story.
    const alias = computeEsbuildAlias(process.env, root);
    const nodePaths = computeNodePaths(process.env);
    const verifyPackMode = nodePaths.length > 0;

    // The preload comes from the packed `@chimera/electron/preload/api` export in
    // verify:pack mode (true-artifact validation), or from host source otherwise.
    const consumerRequire = verifyPackMode
        ? createRequire(path.join(path.dirname(nodePaths[0]!), 'package.json'))
        : undefined;
    const preloadEntry =
        consumerRequire !== undefined
            ? consumerRequire.resolve('@chimera/electron/preload/api')
            : path.join(root, 'electron/preload/api.ts');

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
        nodePaths,
    });

    // Preload script — runs in a sandboxed renderer context but has access to
    // Node.js APIs via contextBridge; bundle as CJS with Electron as external.
    buildSync({
        entryPoints: [preloadEntry],
        outfile: preloadOutfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['electron'],
        alias,
        nodePaths,
    });

    // Inspector window preload — the debug bridge (electron/main/debug-bridge.ts)
    // loads it from path.dirname(<main preload>)/debug-api.js, so it must sit next
    // to api.js for debug-mode (CHIMERA_DEBUG=1) launches. Skipped in verify:pack
    // mode: `@chimera/electron/preload/debug-api` is intentionally NOT a public
    // export (Invariant #27), and the gate excludes the debug specs (--grep-invert).
    if (!verifyPackMode) {
        buildSync({
            entryPoints: [path.join(root, 'electron/preload/debug-api.ts')],
            outfile: path.join(path.dirname(preloadOutfile), 'debug-api.js'),
            bundle: true,
            platform: 'node',
            format: 'cjs',
            target: 'node20',
            external: ['electron'],
            alias,
            nodePaths,
        });
    }
}
