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
 */

export { SnapshotRingBuffer, DEFAULT_RING_BUFFER_CAPACITY } from './SnapshotRingBuffer.js';
export type { RingBufferEntry } from './SnapshotRingBuffer.js';
