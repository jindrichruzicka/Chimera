/**
 * tools/verify-packaged-bundle.ts
 *
 * `verify:packaged-bundle` — the MONOREPO's thin driver for the engine-owned
 * packaged-bundle guard (§4.12, Invariant #27). It asserts the Runtime Debug
 * Layer is absent from the bundles a REAL packaging run of the reference app
 * emits, by pointing `verifyPackagedBundle` from
 * `@chimera-engine/electron/packaged-bundle` at `apps/tactics`.
 *
 * Everything of substance lives in the engine export — the marker set, the
 * content predicates, the electron-builder allowlist checks, and the
 * per-predicate negative controls that make every run self-validating — so the
 * monorepo and every scaffolded game (whose template ships the mirror-image
 * driver, `templates/blank/electron/verify-packaged-bundle.ts`) verify the same
 * property through ONE definition. This file owns only what the engine must
 * not: the repo paths and the real build invocation (§3 dependency direction —
 * the engine package never imports from `tools/` or an app).
 *
 * The driver deliberately imports data, not bundling logic, from the app: the
 * outfile map `appBundleOutfiles` and the packaging env var name, both from the
 * app's own build plan — the gate tracks the plan, never restates it. The path
 * coupling fails CLOSED: outputs are deleted before each build, so a diverged
 * map finds no file and fails loudly rather than reading a stale one.
 *
 * ⚠️ SIDE EFFECT: `build:app` writes the same `apps/<game>/dist` path a dev
 * launch runs from, so a packaged build leaves the F9 Inspector dead until the
 * dev bundle is rebuilt. The engine runner ALWAYS rebuilds it before returning,
 * including on failure. Do not run this concurrently with a dev launch.
 *
 * Requires built `@chimera-engine/*` dists (build-before-consume, like every
 * consumer of the engine `exports` maps); CI and the merge gate both run it
 * after the build/test steps.
 *
 * Usage:
 *   tsx tools/verify-packaged-bundle.ts
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyPackagedBundle } from '@chimera-engine/electron/packaged-bundle';

import { appBundleOutfiles, PACKAGED_BUILD_ENV } from '../apps/tactics/electron/build-main.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(ROOT, 'apps/tactics');
const APP_PACKAGE = '@chimera-engine/tactics';

function main(): void {
    const ok = verifyPackagedBundle(
        { appDir: APP_DIR, outfiles: appBundleOutfiles(APP_DIR) },
        {
            /**
             * Run the app's real bundler exactly as the packaging scripts do —
             * same script, same package filter, same env var (the
             * `CHIMERA_PACKAGED_BUILD=1 … build:app` segment of
             * `package:tactics`). Anything less specific (calling `tsx
             * electron/build-main.ts` directly, say) would reintroduce a
             * restatement of the shipped command.
             */
            buildApp: (packaged) => {
                execFileSync('pnpm', ['--filter', APP_PACKAGE, 'build:app'], {
                    cwd: ROOT,
                    stdio: 'inherit',
                    env: packaged ? { ...process.env, [PACKAGED_BUILD_ENV]: '1' } : process.env,
                });
            },
            readFile: (file) => readFileSync(file, 'utf8'),
            fileExists: existsSync,
            removeFile: (file) => rmSync(file, { force: true }),
            log: (message) => console.log(`[verify:packaged-bundle] ${message}`),
            error: (message) => console.error(message),
        },
    );

    if (ok) {
        console.log('[verify:packaged-bundle] the real packaged bundles carry no debug layer.');
    } else {
        process.exitCode = 1;
    }
}

// Direct-run guard, mirroring build-main.ts: importing this module must never
// trigger real builds, and the VITEST guard keeps process spawning + disk I/O
// out of the unit surface.
function isDirectRun(): boolean {
    const entry = process.argv[1];
    if (entry === undefined) return false;
    try {
        return path.resolve(entry) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
}

if (process.env['VITEST'] === undefined && isDirectRun()) {
    main();
}
