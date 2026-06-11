/**
 * Shared system-level constants consumed by both the main process and the
 * renderer. Declared in `shared/` so the preload bridge, the renderer, and
 * the Electron main entry all refer to the same literal strings.
 */

/**
 * IPC channel that exposes the captured crash-recovery status to the
 * renderer. The main process registers a single `ipcMain.handle` for this
 * channel at startup; the renderer calls it via the preload bridge.
 *
 * Namespaced per architecture convention: `chimera:<domain>:<name>`.
 */
export const CLEAN_EXIT_IPC_CHANNEL = 'chimera:system:was-clean-exit';

/**
 * File name of the clean-exit sentinel written under `app.getPath("userData")`
 * on shutdown. Its presence at startup means the previous session exited via
 * the `before-quit` hook; its absence means the process was killed (crash,
 * SIGKILL, power loss).
 */
export const CLEAN_EXIT_FLAG_FILENAME = 'lastCleanExit.flag';

/**
 * Whether the runtime debug layer (§4.12) is enabled for this process.
 *
 * Replaced at build time by bundler `define` configuration, so the debug
 * module graph is tree-shaken out of production builds. Both reads MUST stay
 * dot access — `define` replacement only matches dot-access member
 * expressions, never bracket access.
 *
 * Invariant #27: `CHIMERA_DEBUG` never appears in production packaging; the
 * production build asserts `IS_DEBUG_MODE === false` at startup and refuses
 * to start otherwise (see `electron/main/startup-guard.ts`).
 */
export const IS_DEBUG_MODE =
    process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';
