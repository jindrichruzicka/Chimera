// renderer/types/chimera-debug.d.ts
//
// Global `Window.__chimeraDebug` augmentation consumed by the Inspector
// debug page (§4.12 — Runtime Debug Layer). Mirrors `chimera.d.ts`: the
// `ChimeraDebugApi` type itself lives in
// `@chimera-engine/simulation/bridge/debug-api-types` (the neutral leaf both the
// renderer and electron/preload import), so the renderer's view and the
// Inspector preload's exposure stay in lockstep — with zero runtime import
// of Electron or `simulation/debug` (the whole chain is `import type` and
// erased at compile time, Invariant #27).
//
// The property is OPTIONAL: only the Inspector `BrowserWindow` (preload
// `debug-api.ts`) populates it. In the game renderer window it is always
// `undefined` — the game preload exposes no debug data surface, only the
// data-free Inspector toggle (Invariant #28) — so the debug page must
// guard for absence rather than assume it.

import type { ChimeraDebugApi } from '@chimera-engine/simulation/bridge/debug-api-types.js';

declare global {
    interface Window {
        /**
         * Debug Inspector bridge surface. Populated by
         * `contextBridge.exposeInMainWorld('__chimeraDebug', …)` in
         * `electron/preload/debug-api.ts` — Inspector window only.
         */
        readonly __chimeraDebug?: ChimeraDebugApi;
    }
}

export {};
