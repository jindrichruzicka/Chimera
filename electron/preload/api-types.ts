// electron/preload/api-types.ts
//
// Re-export shim (F62/F65 back-edge cleanup). The host↔renderer bridge contract
// (`ChimeraAPI` / `window.__chimera`) now lives in the foundational leaf
// `@chimera-engine/simulation/bridge/api-types` — the one place BOTH the renderer (which
// consumes the bridge) and `electron/preload` (Invariant #5: depends on
// `@chimera-engine/simulation` contracts only) may import it without a cross-layer
// back-edge. The contract depends only on `@chimera-engine/simulation`. This shim keeps the
// public `@chimera-engine/electron/preload/api-types` surface (consumed by the preload
// namespace factories, the main-process IPC handlers, and external API consumers)
// unchanged while removing the old renderer→electron type back-edge.
export * from '@chimera-engine/simulation/bridge/api-types.js';
