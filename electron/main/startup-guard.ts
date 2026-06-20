// electron/main/startup-guard.ts
//
// Pure production startup guards — imports only from `shared/`, no Electron or
// Node imports, so they can be unit-tested without any module mocking overhead.
//
// Invariant #27: `CHIMERA_DEBUG` must never appear in production packaging;
//   production build asserts `IS_DEBUG_MODE === false` at startup.
// Invariant #28: `window.__chimeraDebug` is exposed only in the Inspector
//   Window preload; the game-renderer preload must never expose it.
// Invariant #77: the process refuses to start when `CHIMERA_DEV_HARNESS=1` is
//   combined with `NODE_ENV=production`.

import { IS_DEBUG_MODE } from '@chimera/simulation/foundation/constants.js';

/**
 * Asserts that debug mode is fully disabled when the process is running in a
 * production `NODE_ENV`: the `CHIMERA_DEBUG` environment variable must be
 * absent, and the build-time `IS_DEBUG_MODE` constant must be `false`.
 *
 * Must be called as the first thing inside `main()` so the process refuses to
 * start rather than silently running a debug-capable binary in production.
 *
 * @param env - Raw `process.env` (or a test-injected substitute).
 * @param isDebugMode - The baked `IS_DEBUG_MODE` constant. Defaults to the
 *   real value so the `main()` call site cannot forget to wire it; tests
 *   inject explicit values.
 *
 * @throws Error — when `NODE_ENV === "production"` **and** either
 *   `CHIMERA_DEBUG` is defined (misconfigured environment) or `isDebugMode`
 *   is `true` (binary built with the debug module graph baked in). The error
 *   message names the offending flag and the invariant so an operator reading
 *   logs can diagnose the misconfiguration immediately.
 */
export function assertProductionDebugGuard(
    env: Readonly<Record<string, string | undefined>>,
    isDebugMode: boolean = IS_DEBUG_MODE,
): void {
    if (env['NODE_ENV'] !== 'production') {
        return;
    }
    if (env['CHIMERA_DEBUG'] !== undefined) {
        throw new Error(
            'CHIMERA_DEBUG must not be set in production builds ' +
                '(Invariant #27: IS_DEBUG_MODE must be false at production startup). ' +
                'Unset CHIMERA_DEBUG before packaging or running in production.',
        );
    }
    if (isDebugMode) {
        throw new Error(
            'IS_DEBUG_MODE is true in a production process ' +
                '(Invariant #27: the production build must assert IS_DEBUG_MODE === false at startup). ' +
                'This binary was built with the debug module graph baked in — ' +
                'rebuild without CHIMERA_DEBUG before running in production.',
        );
    }
}

/**
 * Asserts that the dev multiplayer harness is not active in a production
 * `NODE_ENV` (Invariant #77). The harness activates only on the exact value
 * `CHIMERA_DEV_HARNESS === '1'` (see `parseHarnessFlags`); the guard mirrors
 * that activation condition.
 *
 * NODE_ENV is read through the injected parameter rather than
 * `process.env.NODE_ENV` so the check stays a genuine runtime read once §4.12
 * bundler `define` replacement lands — a dev-baked bundle launched with
 * `NODE_ENV=production` must still refuse to start.
 *
 * @param env - Raw `process.env` (or a test-injected substitute).
 *
 * @throws Error — when `CHIMERA_DEV_HARNESS === "1"` **and**
 *   `NODE_ENV === "production"`.
 */
export function assertProductionDevHarnessGuard(
    env: Readonly<Record<string, string | undefined>>,
): void {
    if (env['CHIMERA_DEV_HARNESS'] === '1' && env['NODE_ENV'] === 'production') {
        throw new Error('CHIMERA_DEV_HARNESS is enabled in a production build. Refusing to start.');
    }
}
