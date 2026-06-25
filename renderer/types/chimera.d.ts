// renderer/types/chimera.d.ts
//
// Global `Window.__chimera` augmentation consumed by the renderer. Declaring
// it here means renderer TypeScript sees the typed bridge without importing
// any Electron module — the renderer must not depend on Electron runtime
// types (architecture §4.1).
//
// The `ChimeraAPI` type itself lives in `@chimera/simulation/bridge/api-types`
// (the neutral leaf both the renderer and electron/preload import); re-using it
// here guarantees the renderer's view and the preload's exposure stay in lockstep.

import type { ChimeraAPI } from '@chimera/simulation/bridge/api-types.js';

declare global {
    interface Window {
        /**
         * The one-and-only Chimera bridge surface. Populated by
         * `contextBridge.exposeInMainWorld('__chimera', …)` in
         * `electron/preload/api.ts` before any renderer script runs.
         */
        readonly __chimera: ChimeraAPI;
    }
}

export {};
