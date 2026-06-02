/**
 * simulation/replay/index.ts
 *
 * Public API barrel for the simulation/replay sub-module.
 *
 * Consumers import from `@chimera/simulation/replay` rather than
 * internal module paths directly.
 *
 * Populated as F44 tasks land:
 *   - T1 (#655): ReplayFile schema, parseReplayFile, ReplayParseError,
 *                serializeReplay, deserializeReplay
 *   - T2 (#656): ReplayPlayer, replay seek/determinism errors,
 *                typed initial snapshots, assertReplayDeterministic
 *   - T3 (#657): ReplayHeader, ReplayRepository + in-memory double,
 *                ReplaySerializer strategy, ReplayMigrator + ReplayVersionError
 */

export type {
    RecordedAction,
    ReplayFile,
    ReplayHeader,
    ReplayMetadata,
    ReplayPlayerMetadata,
} from './ReplayFile.js';
export { parseReplayFile, ReplayParseError } from './ReplayFile.js';
export { serializeReplay, deserializeReplay, JsonReplaySerializer } from './ReplaySerializer.js';
export type { ReplaySerializer } from './ReplaySerializer.js';
export type { ReplayRepository } from './ReplayRepository.js';
export { ReplayNotFoundError } from './ReplayRepository.js';
export { InMemoryReplayRepository } from './InMemoryReplayRepository.js';
export type {
    ReplayCompatibilityTarget,
    ReplayMigration,
    ReplayVersionTriple,
} from './ReplayMigrator.js';
export { ReplayMigrator, ReplayVersionError, SUPPORTED_FORMAT_VERSION } from './ReplayMigrator.js';
export type {
    ReplayEnvelopeMismatchField,
    ReplayFrameCallback,
    ReplayInitialSnapshotFactory,
    ReplayStopFn,
} from './ReplayPlayer.js';
export {
    assertReplayDeterministic,
    createBaseReplayInitialSnapshot,
    DeterminismError,
    ReplayEnvelopeMismatchError,
    ReplayPlayer,
    ReplaySeekError,
} from './ReplayPlayer.js';
