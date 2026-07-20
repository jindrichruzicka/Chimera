// Pure production startup guards — no Electron or Node imports, so they can be
// unit-tested without any module mocking overhead. The Electron-owned signal
// they need (`app.isPackaged`) is injected by the `main()` call site.
//
// Invariant #27: `CHIMERA_DEBUG` must never appear in production packaging;
//   production build asserts `IS_DEBUG_MODE === false` at startup.
// Invariant #28: `window.__chimeraDebug` is exposed only in the Inspector
//   Window preload; the game-renderer preload must never expose it.
// Invariant #77: the process refuses to start when `CHIMERA_DEV_HARNESS=1` is
//   combined with a production runtime.
//
// "Production runtime" means PACKAGED or `NODE_ENV=production` — see
// {@link isProductionRuntime}.

import { IS_DEBUG_MODE } from '@chimera-engine/simulation/foundation/constants.js';

/**
 * The canonical "this is a production runtime" predicate shared by Invariants
 * #27 and #77. A binary is production when it is packaged **or** launched with
 * `NODE_ENV=production`.
 *
 * Packaging alone must count: an electron-builder-packaged launch never sets
 * `NODE_ENV`, so a `NODE_ENV`-only test is vacuous for exactly the binaries the
 * guards exist to protect. `app.isPackaged` is the sole trusted build signal —
 * the same signal the replay privacy gate trusts
 * (`replay/deterministicReplayPort.ts`).
 *
 * Deliberately NOT used by that replay gate, which is `isPackaged`-only by
 * design: a dev process launched with `NODE_ENV=production` must still record
 * replays. Widening it to this predicate would be a behaviour change, not a
 * unification.
 *
 * @param env - Raw `process.env` (or a test-injected substitute).
 * @param isPackaged - `app.isPackaged` at the call site.
 */
export function isProductionRuntime(
    env: Readonly<Record<string, string | undefined>>,
    isPackaged: boolean,
): boolean {
    return isPackaged || env['NODE_ENV'] === 'production';
}

/**
 * Asserts that debug mode is fully disabled when the process is a production
 * runtime (packaged **or** `NODE_ENV=production`): the `CHIMERA_DEBUG`
 * environment variable must be absent, and the build-time `IS_DEBUG_MODE`
 * constant must be `false`.
 *
 * Must be called as the first thing inside `main()` so the process refuses to
 * start rather than silently running a debug-capable binary in production.
 *
 * @param env - Raw `process.env` (or a test-injected substitute).
 * @param isDebugMode - The baked `IS_DEBUG_MODE` constant. Defaults to the
 *   real value so the `main()` call site cannot forget to wire it; tests
 *   inject explicit values.
 * @param isPackaged - `app.isPackaged`. The `main()` call site MUST pass it;
 *   the `false` default exists only so the pure unit tests can exercise the
 *   `NODE_ENV` path without naming it. A packaged binary is production even
 *   when `NODE_ENV` is unset or `development`.
 *
 *   That default is deliberately fail-OPEN, which is the exact shape of the bug
 *   Invariant #27 was re-hardened against, so it is accepted only because both
 *   escape routes are closed: this module is not in the package's public
 *   `exports`, so there is exactly one call site (the `main()` composition
 *   root), and that call site is mutation-defended — dropping the argument
 *   makes `main() CHIMERA_DEBUG production guard` in `index.test.ts` fail,
 *   because the suite's electron mock is packaged with no `NODE_ENV`. Making
 *   the parameter required would force every unit-test call to name
 *   `isDebugMode` positionally too, obscuring what each case is actually
 *   asserting. If this ever gains a second call site, make it required instead.
 *
 * @throws Error — when the process is a production runtime **and** either
 *   `CHIMERA_DEBUG` is defined (misconfigured environment) or `isDebugMode`
 *   is `true` (binary built with the debug module graph baked in). The error
 *   message names the offending flag and the invariant so an operator reading
 *   logs can diagnose the misconfiguration immediately.
 */
export function assertProductionDebugGuard(
    env: Readonly<Record<string, string | undefined>>,
    isDebugMode: boolean = IS_DEBUG_MODE,
    isPackaged = false,
): void {
    if (!isProductionRuntime(env, isPackaged)) {
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
 * runtime — packaged **or** `NODE_ENV=production`, the same
 * {@link isProductionRuntime} predicate as Invariant #27 (Invariant #77). The
 * harness activates only on the exact value `CHIMERA_DEV_HARNESS === '1'` (see
 * `parseHarnessFlags`); the guard mirrors that activation condition.
 *
 * NODE_ENV is read through the injected parameter rather than
 * `process.env.NODE_ENV` so the check stays a genuine runtime read despite the
 * §4.12 bundler `define` replacement — a dev-baked bundle launched with
 * `NODE_ENV=production` must still refuse to start.
 *
 * @param env - Raw `process.env` (or a test-injected substitute).
 * @param isPackaged - `app.isPackaged`. The `main()` call site MUST pass it;
 *   the `false` default exists only for the pure unit tests, and is accepted
 *   for the reasons recorded on {@link assertProductionDebugGuard}. This call
 *   site is mutation-defended by `main() CHIMERA_DEV_HARNESS guard`.
 *
 * @throws Error — when `CHIMERA_DEV_HARNESS === "1"` **and** the process is a
 *   production runtime.
 */
export function assertProductionDevHarnessGuard(
    env: Readonly<Record<string, string | undefined>>,
    isPackaged = false,
): void {
    if (env['CHIMERA_DEV_HARNESS'] === '1' && isProductionRuntime(env, isPackaged)) {
        throw new Error('CHIMERA_DEV_HARNESS is enabled in a production build. Refusing to start.');
    }
}
