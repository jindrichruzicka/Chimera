// Re-export shim. The host↔renderer bridge contract (`ChimeraAPI` /
// `window.__chimera`) lives in the foundational leaf
// `@chimera-engine/simulation/bridge/api-types` — the one place BOTH the renderer
// (which consumes the bridge) and `electron/preload` (Invariant #5: depends on
// `@chimera-engine/simulation` contracts only) may import it without a cross-layer
// back-edge. This shim re-exports it so the public
// `@chimera-engine/electron/preload/api-types` surface (consumed by the preload
// namespace factories, the main-process IPC handlers, and external API consumers)
// stays stable.
export * from '@chimera-engine/simulation/bridge/api-types.js';
