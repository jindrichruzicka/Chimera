/**
 * simulation/debug/index.ts
 *
 * Public API barrel for the simulation/debug sub-module (§4.12 — Runtime
 * Debug Layer).
 *
 * Consumers import from `@chimera/simulation/debug` rather than internal
 * module paths directly. Everything here is debug-only tooling: instantiated
 * exclusively when `IS_DEBUG_MODE` is true (Invariant #31) and tree-shaken
 * out of production builds.
 *
 * Populated as F47 tasks land:
 *   - T1 (#690): SnapshotRingBuffer, RingBufferEntry,
 *                DEFAULT_RING_BUFFER_CAPACITY
 *   - T2 (#691): diffSnapshots, DiffEntry, SnapshotDiff
 *   - T3 (#692): SnapshotInspector, TickNotAvailableError,
 *                DEFAULT_PERF_SAMPLE_CAPACITY, DebugProtocol types
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
} from './DebugProtocol.js';
