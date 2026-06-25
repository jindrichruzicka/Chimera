/**
 * tools/build-tactics-app.ts
 *
 * Production build of the tactics app's Electron MAIN entry: bundles the
 * consumer composition root `apps/tactics/electron/main.ts` (which constructs the
 * tactics `MainGameContribution` and calls the game-agnostic host
 * `@chimera/electron/main`'s `main()`) into a single runnable CJS file at
 * `apps/tactics/dist/electron/main.js`, the path `apps/tactics/package.json`
 * `"main"` points at. This is what makes `apps/tactics` a self-contained
 * layer-3 app: it owns its Electron entry instead of the workspace root (#791).
 *
 * Transitional (F64): the `@chimera/*` specifiers are resolved with the same
 * source aliases the E2E bundler uses (`apps/tactics/e2e/global-setup.ts`) —
 * `@chimera/electron/main` onto host SOURCE (its `dist/` is ESM and not yet
 * launchable as a bundled main) and `@chimera/tactics` onto its package root.
 * F64's build/link pipeline flips these onto each package's `exports` map and
 * folds the preload + renderer packaging in; this script intentionally bundles
 * only the main entry so the app has a buildable, declared Electron entry now.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { buildSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const entry = path.join(root, 'apps/tactics/electron/main.ts');
const outfile = path.join(root, 'apps/tactics/dist/electron/main.js');

mkdirSync(path.dirname(outfile), { recursive: true });

buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron', 'node:*'],
    alias: {
        '@chimera/tactics': path.join(root, 'apps/tactics'),
        '@chimera/electron/main': path.join(root, 'electron/main/index.ts'),
    },
});

console.log(`[build:app] bundled tactics Electron main → ${path.relative(root, outfile)}`);
