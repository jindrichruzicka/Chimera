/**
 * simulation/debug/index.ts
 *
 * Public API barrel for the simulation/debug sub-module (§4.12 — Runtime
 * Debug Layer).
 *
 * Consumers import from `@chimera-engine/simulation/debug` rather than internal
 * module paths directly. Everything here is debug-only tooling: instantiated
 * exclusively when `IS_DEBUG_MODE` is true (Invariant #31), which a packaged
 * build folds to the literal `false` — so none of it is ever constructed in a
 * distributable. It is not merely unreachable there but ABSENT: the app bundler
 * folds the debug gate in `electron/main/index.ts` and prunes the dynamic import
 * that reaches this barrel, so none of these modules enter a packaged bundle.
 *
 * The source stays, and this barrel stays public: `DebugProtocol` and
 * `SnapshotDiff` have type-only importers reaching the renderer, which cost zero
 * runtime bytes. Absence from the bundle is the goal, not deletion.
 */

export { SnapshotRingBuffer, DEFAULT_RING_BUFFER_CAPACITY } from './SnapshotRingBuffer.js';
export type { RingBufferEntry } from './SnapshotRingBuffer.js';
export { diffSnapshots } from './SnapshotDiff.js';
export type { DiffEntry, SnapshotDiff } from './SnapshotDiff.js';
export {
    SnapshotInspector,
    TickNotAvailableError,
    DEFAULT_PERF_SAMPLE_CAPACITY,
} from './SnapshotInspector.js';
export type { SnapshotInspectorOptions, InspectorMemento } from './SnapshotInspector.js';
export type {
    DebugRequest,
    DebugResponse,
    TickEntry,
    TickDurationSample,
    PerfStats,
    NetworkDiagnostics,
} from './DebugProtocol.js';
