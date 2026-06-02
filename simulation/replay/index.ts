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
 */

export type {
    RecordedAction,
    ReplayFile,
    ReplayMetadata,
    ReplayPlayerMetadata,
} from './ReplayFile.js';
export { parseReplayFile, ReplayParseError } from './ReplayFile.js';
export { serializeReplay, deserializeReplay } from './ReplaySerializer.js';
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
