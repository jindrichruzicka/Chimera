// electron/preload/debug-api-types.ts
//
// Re-export shim. The Debug Inspector bridge contract (`ChimeraDebugApi`) lives
// in `@chimera-engine/simulation/bridge/debug-api-types` (same neutral-leaf
// rationale as the sibling api-types shim — both renderer and electron/preload
// may import it). Electron re-exports it so the public
// `@chimera-engine/electron/preload/debug-api-types` surface stays stable. Invariant
// #27/#28: this remains the Debug Inspector surface only.
export * from '@chimera-engine/simulation/bridge/debug-api-types.js';
