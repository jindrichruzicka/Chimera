/**
 * simulation/replay/index.ts
 *
 * Public API barrel for the simulation/replay sub-module.
 *
 * Consumers import from `@chimera-engine/simulation/replay` rather than
 * internal module paths directly.
 */

export type {
    PerspectiveReplayFile,
    PerspectiveReplayFrame,
    PerspectiveReplayHeader,
} from './PerspectiveReplayFile.js';
export { parsePerspectiveReplayFile } from './PerspectiveReplayFile.js';
export type {
    RecordedAction,
    ReplayFile,
    ReplayHeader,
    ReplayMetadata,
    ReplayPlayerMetadata,
} from './ReplayFile.js';
export { parseReplayFile, ReplayParseError } from './ReplayFile.js';
export {
    serializeReplay,
    deserializeReplay,
    safeReviver,
    JsonReplaySerializer,
} from './ReplaySerializer.js';
export type { ReplaySerializer, PerspectiveReplaySerializer } from './ReplaySerializer.js';
export type { ReplayListingEntry, ReplayRepository } from './ReplayRepository.js';
export { ReplayNotFoundError } from './ReplayRepository.js';
export type {
    PerspectiveReplayListItem,
    PerspectiveReplayRepository,
} from './PerspectiveReplayRepository.js';
export { InMemoryReplayRepository } from './InMemoryReplayRepository.js';
export { InMemoryPerspectiveReplayRepository } from './InMemoryPerspectiveReplayRepository.js';
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
