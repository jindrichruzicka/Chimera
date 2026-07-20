/**
 * Shared system-level constants consumed by both the main process and the
 * renderer. Declared in `simulation/foundation/` so the preload bridge, the
 * renderer, and the Electron main entry all refer to the same literal strings.
 */

/**
 * Runtime Debug Layer IPC channels (§4.12). Plain string
 * constants declared here so the Inspector preload (`debug-api.ts`) and the
 * main-process debug bridge share the same literals without the preload
 * importing the debug module graph (Invariant #27: no debug code lives in this
 * foundation module). In production no handler or listener is ever registered
 * on any of them, so renderer sends are true no-ops.
 */
/** Invoke channel for all `DebugRequest` variants (Invariant #29). */
export const DEBUG_CHANNEL = 'chimera:debug';
/** Data-free window-management send channel — no simulation data crosses it. */
export const DEBUG_TOGGLE_INSPECTOR_CHANNEL = 'chimera:debug:toggle-inspector';
/**
 * Data-free display-command send channel: flips the game renderer's i18n
 * token mode (raw tokens instead of translated strings) for translation
 * auditing. The bridge owns the boolean and pushes each new value back to the
 * game window over `chimera:system:i18n-token-mode`.
 */
export const DEBUG_TOGGLE_I18N_TOKEN_MODE_CHANNEL = 'chimera:debug:toggle-i18n-token-mode';
/** Main → Inspector push channel carrying `LIVE_TICK` responses. */
export const DEBUG_PUSH_CHANNEL = 'chimera:debug:push';

/**
 * Whether the runtime debug layer (§4.12) is enabled for this process.
 *
 * Replaced at build time by bundler `define` configuration, so a packaged build
 * folds this to the literal `false` and the debug gate is dead in every
 * distributable. Both reads MUST stay dot access — `define` replacement only
 * matches dot-access member expressions, never bracket access.
 *
 * ⚠️ This expression is DUPLICATED, deliberately. `electron/main/index.ts` gates
 * the debug bridge on a character-identical inline copy rather than importing
 * this constant, because esbuild does not propagate a cross-module constant into
 * a consuming module — imported, the branch stayed live and the whole debug graph
 * shipped in every distributable. Inlined, it folds to `if (false)` and esbuild
 * prunes the dynamic imports behind it. **Change this expression and you must
 * change that one**; `tools/packaged-build-flag.test.ts` fails if they diverge,
 * since silent drift would restore the shipped graph.
 *
 * Invariant #27: `CHIMERA_DEBUG` never appears in production packaging; a
 * production runtime — PACKAGED (`app.isPackaged`) or `NODE_ENV=production` —
 * asserts `IS_DEBUG_MODE === false` at startup and refuses to start otherwise
 * (see `isProductionRuntime` in `electron/main/startup-guard.ts`). Packaging
 * alone must count: electron-builder never sets `NODE_ENV`.
 */
export const IS_DEBUG_MODE =
    process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';
