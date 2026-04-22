/**
 * simulation/persistence/index.ts
 *
 * Public API barrel for the simulation/persistence sub-module.
 *
 * Re-exports all persistence types and classes so consumers import from
 * `@chimera/simulation/persistence` rather than internal module paths.
 *
 * Populated progressively as F06 tasks land:
 *   - T1 (#120): SaveFile, SaveSerializer, JsonSaveSerializer, CompressedSaveSerializer
 *   - T2 (#121): SaveMigrator, SaveMigration, SaveNotFoundError, SaveSchemaTooNewError
 *   - T3 (#122): SaveRepository, SaveSlotMeta, InMemorySaveRepository
 */

export type { CommitmentId, CommitmentEnvelope, SaveFileHeader, SaveFile } from './SaveFile.js';
export type { SaveSerializer } from './SaveSerializer.js';
export { JsonSaveSerializer } from './JsonSaveSerializer.js';
export { CompressedSaveSerializer } from './CompressedSaveSerializer.js';
