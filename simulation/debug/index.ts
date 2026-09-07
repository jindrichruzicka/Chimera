/**
 * simulation/debug/index.ts
 *
 * Public API barrel for the simulation/debug sub-module (§4.12 — Runtime
 * Debug Layer).
 *
 * Consumers import from `@chimera-engine/simulation/debug` rather than internal
 * module paths directly. Everything this barrel OWNS is debug-only tooling:
 * instantiated exclusively when `IS_DEBUG_MODE` is true (Invariant #31), which a
 * packaged build folds to the literal `false` — so none of it is ever
 * constructed in a distributable. It is not merely unreachable there but
 * ABSENT: the app bundler folds the debug gate in `electron/main/index.ts` and
 * prunes the dynamic import that reaches this barrel, so nothing this barrel
 * owns enters a packaged bundle.
 *
 * The re-exported `diffSnapshots` is the exception, and is not this barrel's:
 * it lives in the contract leaf and `StateBroadcaster` imports it directly, so
 * it ships. Why the marker set excludes it is
 * `electron/packaged-bundle/debug-bundle-markers.ts`'s to say.
 *
 * The source stays, and this barrel stays public: `DebugProtocol` has type-only
 * importers reaching the renderer, which cost zero runtime bytes. Absence from
 * the bundle is the goal, not deletion.
 */

export { SnapshotRingBuffer, DEFAULT_RING_BUFFER_CAPACITY } from './SnapshotRingBuffer.js';
export type { RingBufferEntry } from './SnapshotRingBuffer.js';
export { diffSnapshots } from '../foundation/snapshot-diff.js';
export type { DiffEntry, SnapshotDiff } from '../foundation/snapshot-diff.js';
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
