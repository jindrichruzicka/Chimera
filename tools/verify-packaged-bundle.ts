/**
 * tools/verify-packaged-bundle.ts
 *
 * `verify:packaged-bundle` — the MONOREPO's thin driver for the engine-owned
 * packaged-bundle guard (§4.12, Invariant #27). It asserts the Runtime Debug
 * Layer is absent from the bundles a REAL packaging run emits, by pointing
 * `verifyPackagedBundle` from `@chimera-engine/electron/packaged-bundle` at each
 * consumer app in `VERIFIED_APPS` below.
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
 * The driver imports data, not bundling logic: the outfile map
 * `appBundleOutfiles` and the packaging env var name, both from
 * `@chimera-engine/electron/build-main` — the same plan the app's own
 * `build:app` driver runs, so this restates nothing. The path coupling fails
 * CLOSED: outputs are deleted before each build, so a diverged map finds no
 * file and fails loudly rather than reading a stale one.
 *
 * Reaching the plan through the ENGINE rather than through an app's
 * `electron/build-main.ts` is what keeps `tools/` off an `apps/` import
 * (§3 dependency direction). An app driver is free to pass its own `outfiles` —
 * a scaffolded game's gate therefore imports from `./build-main.js`, whose
 * re-export tracks whatever that game's driver does. This one can take the
 * engine default only because the apps it verifies take it too, which
 * `tools/verify-packaged-bundle.test.ts` pins on each app driver's source.
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

import { appBundleOutfiles, PACKAGED_BUILD_ENV } from '@chimera-engine/electron/build-main';
import { verifyPackagedBundle } from '@chimera-engine/electron/packaged-bundle';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every consumer app whose real packaging build this gate verifies, as
 * `[workspace-relative dir, package name]`.
 *
 * Enumerated rather than discovered from `apps/`, because each entry costs two
 * real esbuild runs: an app added here is a deliberate decision to pay that on
 * every merge gate, not something a new directory should trigger silently. The
 * cost of MISSING one is the whole point of the gate, though — `build:app` and
 * `electron-builder.yml` are app-owned and either can reship the debug layer —
 * so a new app belongs here the moment it has an Electron composition root.
 */
export const VERIFIED_APPS: readonly (readonly [string, string])[] = [
    ['apps/tactics', '@chimera-engine/tactics'],
    ['apps/action', '@chimera-engine/action'],
];

/**
 * Runs `verify` for EVERY app and answers whether all of them passed.
 *
 * Split out of `main()` and injected rather than inlined, because both halves of
 * it are decisions a mutant can quietly reverse and neither is observable
 * through the CLI: `some` in place of `every` lets a passing first app mask a
 * failing second one, and a short-circuiting `every(([dir, pkg]) => verify(…))`
 * in place of the eager `map` stops the second app being BUILT at all the moment
 * the first fails — so a fix round would only ever surface the next problem after
 * the previous one lands. `verify-packaged-bundle.test.ts` pins both.
 */
export function verifyAllApps(
    apps: readonly (readonly [string, string])[],
    verify: (appDir: string, appPackage: string) => boolean,
): boolean {
    const results = apps.map(([dir, appPackage]) => verify(dir, appPackage));
    return results.every((ok) => ok);
}

function verifyApp(appDir: string, appPackage: string): boolean {
    return verifyPackagedBundle(
        { appDir, outfiles: appBundleOutfiles(appDir) },
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
                execFileSync('pnpm', ['--filter', appPackage, 'build:app'], {
                    cwd: ROOT,
                    stdio: 'inherit',
                    env: packaged ? { ...process.env, [PACKAGED_BUILD_ENV]: '1' } : process.env,
                });
            },
            readFile: (file) => readFileSync(file, 'utf8'),
            fileExists: existsSync,
            removeFile: (file) => rmSync(file, { force: true }),
            log: (message) => console.log(`[verify:packaged-bundle] ${appPackage}: ${message}`),
            error: (message) => console.error(message),
        },
    );
}

function main(): void {
    const ok = verifyAllApps(VERIFIED_APPS, (dir, appPackage) =>
        verifyApp(path.join(ROOT, dir), appPackage),
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
