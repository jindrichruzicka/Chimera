/**
 * simulation/persistence/index.ts
 *
 * Public API barrel for the simulation/persistence sub-module.
 *
 * Re-exports all persistence types and classes so consumers import from
 * `@chimera-engine/simulation/persistence` rather than internal module paths.
 */

export type { SaveFileHeader, SaveFile, SaveSeat, SaveSessionManifest } from './SaveFile.js';
export { deriveSessionManifest } from './SessionManifest.js';
export type { SaveSerializer } from './SaveSerializer.js';
export { JsonSaveSerializer } from './JsonSaveSerializer.js';
export {
    CURRENT_SCHEMA_VERSION,
    checkpointTurnNumberMigration,
    checkpointTimersMigration,
    createDefaultMigrator,
    SaveMigrationError,
    SaveMigrator,
    SaveIntegrityError,
    SaveNotFoundError,
    SaveParseError,
    SaveSchemaTooNewError,
} from './SaveMigrator.js';
export type { SaveMigration } from './SaveMigrator.js';
export type { SaveSlotMeta, SaveRepository } from './SaveRepository.js';
export { InMemorySaveRepository } from './InMemorySaveRepository.js';
export { computeBodyChecksum } from './SaveChecksum.js';
export type { SaveBody } from './SaveChecksum.js';
