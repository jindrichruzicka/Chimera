// electron/main/startup-guard.ts
//
// Pure production startup guard — no Electron or Node imports so it can be
// unit-tested without any module mocking overhead.
//
// Invariant #27: `CHIMERA_DEBUG` must never appear in production packaging;
//   production build asserts `IS_DEBUG_MODE === false` at startup.
// Invariant #28: `window.__chimeraDebug` is exposed only in the Inspector
//   Window preload; the game-renderer preload must never expose it.

/**
 * Asserts that the debug-mode environment variable is absent when the process
 * is running in a production `NODE_ENV`.
 *
 * Must be called as the first thing inside `main()` so the process refuses to
 * start rather than silently running a debug-capable binary in production.
 *
 * @param env - Raw `process.env` (or a test-injected substitute).
 *
 * @throws Error — when `NODE_ENV === "production"` **and** `CHIMERA_DEBUG` is
 *   defined.  The error message names both the flag and the invariant so an
 *   operator reading logs can diagnose the misconfiguration immediately.
 */
export function assertProductionDebugGuard(
    env: Readonly<Record<string, string | undefined>>,
): void {
    if (env['NODE_ENV'] === 'production' && env['CHIMERA_DEBUG'] !== undefined) {
        throw new Error(
            'CHIMERA_DEBUG must not be set in production builds ' +
                '(Invariant #27: IS_DEBUG_MODE must be false at production startup). ' +
                'Unset CHIMERA_DEBUG before packaging or running in production.',
        );
    }
}
