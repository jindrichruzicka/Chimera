/**
 * simulation/persistence/SaveMigrator.ts
 *
 * Migration chain and associated error types for the save persistence system
 * (§4.11). Implements the Chain of Responsibility pattern: each SaveMigration
 * handles one schema version step; the migrator applies them in order until
 * the file reaches CURRENT_SCHEMA_VERSION.
 *
 * Architecture reference: §4.11
 * Task: F06 / T2 (issue #121)
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no Node.js FS or Electron imports.
 */

import type { SaveFile } from './SaveFile.js';

// ─── Schema version ───────────────────────────────────────────────────────────

/**
 * Current save file schema version understood by this engine build.
 * Increment this constant on every breaking change to `SaveFile` or any
 * of its nested types, and add a corresponding `SaveMigration` so that
 * older saves are automatically upgraded.
 */
export const CURRENT_SCHEMA_VERSION = 1;

// ─── SaveMigration interface ──────────────────────────────────────────────────

/**
 * A single migration step in the save-file upgrade chain.
 *
 * `fromVersion` identifies the schema version the migration reads from.
 * `apply` receives the file at that version and must return a new file at
 * `fromVersion + 1`. The migrator sets `header.schemaVersion` automatically
 * after `apply` returns — implementations must NOT mutate or re-set it.
 */
export interface SaveMigration {
    /** The schema version this migration upgrades *from*. */
    readonly fromVersion: number;
    /** Transform the file from `fromVersion` to `fromVersion + 1`. */
    apply(file: SaveFile): SaveFile;
}

// ─── SaveMigrator ─────────────────────────────────────────────────────────────

/**
 * Applies versioned migrations when loading a save file whose schema version
 * is older than `CURRENT_SCHEMA_VERSION`.
 *
 * Migrations are registered with `register()` and applied in ascending
 * `fromVersion` order by `migrate()`. Registration order does not matter —
 * the chain is always sorted by `fromVersion` after each registration.
 *
 * `migrate()` throws `SaveSchemaTooNewError` if the file's schema version
 * exceeds `CURRENT_SCHEMA_VERSION` (file was written by a newer engine).
 */
export class SaveMigrator {
    private readonly migrations: SaveMigration[] = [];

    /**
     * Add a migration step to the chain. After each registration, the
     * chain is re-sorted by `fromVersion` so that registration order is
     * irrelevant to the upgrade sequence applied at load time.
     */
    register(migration: SaveMigration): void {
        this.migrations.push(migration);
        this.migrations.sort((a, b) => a.fromVersion - b.fromVersion);
    }

    /**
     * Upgrade `file` to `CURRENT_SCHEMA_VERSION` by applying each
     * registered migration whose `fromVersion` matches the file's current
     * schema version, repeating until no matching migration remains.
     *
     * Returns the (possibly new) file object. The input is never mutated.
     *
     * @throws {SaveSchemaTooNewError} if `file.header.schemaVersion > CURRENT_SCHEMA_VERSION`.
     */
    migrate(file: SaveFile): SaveFile {
        if (file.header.schemaVersion > CURRENT_SCHEMA_VERSION) {
            throw new SaveSchemaTooNewError(file.header.schemaVersion, CURRENT_SCHEMA_VERSION);
        }

        let current = file;

        for (const migration of this.migrations) {
            if (current.header.schemaVersion === migration.fromVersion) {
                const migrated = migration.apply(current);
                // The migrator owns the schemaVersion bump — apply() must not set it.
                current = {
                    ...migrated,
                    header: {
                        ...migrated.header,
                        schemaVersion: migration.fromVersion + 1,
                    },
                };
            }
        }

        return current;
    }
}

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * Thrown by `SaveRepository.load()` and `SaveRepository.delete()` when no
 * save slot with the given `slotId` exists in the repository.
 */
export class SaveNotFoundError extends Error {
    public readonly slotId: string;

    constructor(slotId: string) {
        super(`Save slot '${slotId}' not found`);
        this.name = 'SaveNotFoundError';
        this.slotId = slotId;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown by `SaveMigrator.migrate()` when the save file's `schemaVersion`
 * is greater than `CURRENT_SCHEMA_VERSION` — the file was written by a
 * newer version of the engine that this build cannot parse.
 */
export class SaveSchemaTooNewError extends Error {
    /** Schema version reported in the save file. */
    public readonly fileVersion: number;
    /** Highest schema version this engine understands. */
    public readonly engineVersion: number;

    constructor(fileVersion: number, engineVersion: number) {
        super(
            `Save file schema v${fileVersion} is newer than this engine supports (v${engineVersion})`,
        );
        this.name = 'SaveSchemaTooNewError';
        this.fileVersion = fileVersion;
        this.engineVersion = engineVersion;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
