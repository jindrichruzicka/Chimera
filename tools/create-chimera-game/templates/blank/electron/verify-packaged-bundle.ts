// The app-OWNED `verify:packaged-bundle` gate — this game's thin driver for the
// engine's packaged-bundle guard (§4.12, Invariant #27), run as
// `pnpm verify:packaged-bundle` from the app (or by `--filter` from the project
// root). It asserts the Runtime Debug Layer is ABSENT from the bundles a REAL
// packaging build of THIS app emits, and that `electron-builder.yml`'s `files:`
// allowlist still names the shipped bundles individually.
//
// Why this exists in a scaffolded game: `electron/build-main.ts` and
// `electron-builder.yml` are yours to edit, and either edit can silently
// reship the debug layer — dropping the packaging define keeps every build
// green while the Inspector graph returns to the shipped bundle, and widening
// `files:` to `dist/**` ships whatever an earlier dev build left in `dist/`.
// This gate reads the bytes the real build emits, so no refactor of the build
// can satisfy it while the debug layer ships.
//
// Everything of substance — the marker set, the content predicates, the
// allowlist checks, and the per-predicate negative controls that make every
// run self-validating (the dev-restore build must be REJECTED by every
// predicate, and a synthetic widened allowlist by every allowlist check) —
// lives in `@chimera-engine/electron/packaged-bundle`, shared with the engine
// monorepo's own gate. This file names no game and owns only the app paths and
// the real build invocation; never copy checks into it — a second definition
// drifts silently, and only in the weaker direction.
//
// The outfile map and the packaging env var are IMPORTED from the app's own
// build plan (`./build-main.js`) — the gate tracks the plan, never restates
// it. The path coupling fails closed: outputs are deleted before each build,
// so a diverged map finds no file and fails loudly instead of reading a stale
// one.
//
// ⚠️ SIDE EFFECT: `build:app` writes the same `dist/` a dev launch runs from,
// so the packaged half of this gate leaves the F9 Inspector dead until the dev
// bundle is rebuilt. The engine runner ALWAYS restores the dev bundle before
// exiting, including on failure — do not run this concurrently with a dev
// launch.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { verifyPackagedBundle } from '@chimera-engine/electron/packaged-bundle';

import { appBundleOutfiles, PACKAGED_BUILD_ENV } from './build-main.js';

function main(): void {
    const appDir = path.resolve(__dirname, '..');

    const ok = verifyPackagedBundle(
        { appDir, outfiles: appBundleOutfiles(appDir) },
        {
            // The app's own `build:app` script, exactly as the project root's
            // `package` script chain runs it — same script, same env var. (In a
            // standalone scaffold that script also self-sets
            // CHIMERA_VERIFY_PACK_NODE_MODULES, so the engine host resolves from
            // node_modules here just as it does in a real packaging run.)
            buildApp: (packaged) => {
                execFileSync('pnpm', ['run', 'build:app'], {
                    cwd: appDir,
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
// out of the unit surface. CJS __dirname/__filename (not `import.meta`) keep
// the file loadable by the same transforms that load build-main.ts.

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
    main();
}
