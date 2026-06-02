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
 */

export type {
    RecordedAction,
    ReplayFile,
    ReplayMetadata,
    ReplayPlayerMetadata,
} from './ReplayFile.js';
export { parseReplayFile, ReplayParseError } from './ReplayFile.js';
export { serializeReplay, deserializeReplay } from './ReplaySerializer.js';
