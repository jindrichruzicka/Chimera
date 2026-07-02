/**
 * Shared system-level constants consumed by both the main process and the
 * renderer. Declared in `shared/` so the preload bridge, the renderer, and
 * the Electron main entry all refer to the same literal strings.
 */

/**
 * Runtime Debug Layer IPC channels (§4.12 — F47 T5/T6). Plain string
 * constants declared here so the Inspector preload (`debug-api.ts`) and the
 * main-process debug bridge share the same literals without the preload
 * importing the debug module graph (Invariant #27: no debug code lives in
 * `shared/`). In production no handler or listener is ever registered on any
 * of them, so renderer sends are true no-ops.
 */
/** Invoke channel for all `DebugRequest` variants (Invariant #29). */
export const DEBUG_CHANNEL = 'chimera:debug';
/** Data-free window-management send channel — no simulation data crosses it. */
export const DEBUG_TOGGLE_INSPECTOR_CHANNEL = 'chimera:debug:toggle-inspector';
/** Main → Inspector push channel carrying `LIVE_TICK` responses. */
export const DEBUG_PUSH_CHANNEL = 'chimera:debug:push';

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
