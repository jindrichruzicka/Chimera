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
export const CURRENT_SCHEMA_VERSION = 3;

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
    private frozen = false;

    /**
     * Add a migration step to the chain. After each registration, the
     * chain is re-sorted by `fromVersion` so that registration order is
     * irrelevant to the upgrade sequence applied at load time.
     *
     * @throws {Error} if called after `migrate()` has already been invoked.
     */
    register(migration: SaveMigration): void {
        if (this.frozen) {
            throw new Error('Cannot register migrations after migrate() has been called');
        }
        this.migrations.push(migration);
        this.migrations.sort((a, b) => a.fromVersion - b.fromVersion);
    }

    /**
     * Upgrade `file` to `CURRENT_SCHEMA_VERSION` by applying each
     * registered migration whose `fromVersion` matches the file's current
     * schema version, repeating until no matching migration remains.
     *
     * Returns the (possibly new) file object. The input is never mutated.
     * After the first call the migrations array is frozen — further calls
     * to `register()` will throw.
     *
     * @throws {SaveMigrationError} if `file.header.schemaVersion` is not a
     *   positive integer (covers `0`, `-1`, `NaN`, `undefined`).
     * @throws {SaveSchemaTooNewError} if `file.header.schemaVersion > CURRENT_SCHEMA_VERSION`.
     * @throws {SaveMigrationError} if the migration chain does not reach
     *   `CURRENT_SCHEMA_VERSION` (gap in registered migrations).
     */
    migrate(file: SaveFile): SaveFile {
        if (!this.frozen) {
            Object.freeze(this.migrations);
            this.frozen = true;
        }

        const version = file.header.schemaVersion;
        if (!Number.isInteger(version) || version < 1) {
            throw new SaveMigrationError(`Invalid schema version: ${JSON.stringify(version)}`);
        }

        if (version > CURRENT_SCHEMA_VERSION) {
            throw new SaveSchemaTooNewError(version, CURRENT_SCHEMA_VERSION);
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

        if (current.header.schemaVersion !== CURRENT_SCHEMA_VERSION) {
            throw new SaveMigrationError(
                `Migration chain incomplete: reached v${current.header.schemaVersion}, expected v${CURRENT_SCHEMA_VERSION}`,
            );
        }

        return current;
    }
}

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * Thrown by `SaveRepository.load()` when a save file's checksum is present
 * but does not match the recomputed checksum of the body. Indicates that the
 * file has been tampered with or corrupted after it was written.
 *
 * Covers OWASP A08 (Software and Data Integrity Failures) and invariant #23.
 */
export class SaveIntegrityError extends Error {
    /** The qualified slot ID that failed verification, if known. */
    public readonly slotId: string | undefined;

    constructor(slotId?: string) {
        const detail = slotId !== undefined ? ` for slot '${slotId}'` : '';
        super(`Save file integrity check failed${detail}: checksum mismatch`);
        this.name = 'SaveIntegrityError';
        this.slotId = slotId;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown by `JsonSaveSerializer.deserialize()` when the raw input fails
 * size validation, JSON parsing, or Zod schema validation. Distinct from
 * `SaveNotFoundError` (missing slot) and `SaveSchemaTooNewError` (future
 * engine version). Covers OWASP A08 (Software and Data Integrity Failures).
 */
export class SaveParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SaveParseError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

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

/**
 * Thrown by `SaveMigrator.migrate()` when the save file's `schemaVersion`
 * is not a valid positive integer (e.g. `0`, `-1`, `NaN`, or `undefined`),
 * or when the registered migration chain does not reach `CURRENT_SCHEMA_VERSION`
 * (indicating a gap in the migrations).
 */
export class SaveMigrationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SaveMigrationError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── Built-in migrations ───────────────────────────────────────────────────────────────────

/**
 * v1 → v2: adds `checkpoint.turnNumber` (default 0) to saves written before
 * `BaseGameSnapshot.turnNumber` was introduced in the engine.
 *
 * Without this migration an old save would deserialize with
 * `checkpoint.turnNumber === undefined`, turning every subsequent
 * `engine:end_turn.reduce` into `NaN + 1` and silently disabling the
 * `pruneTo` retention bound.
 *
 * Register this migration in the wiring point (`electron/main/index.ts`)
 * before the first call to `SaveMigrator.migrate()`.
 */
export const checkpointTurnNumberMigration: SaveMigration = {
    fromVersion: 1,
    apply(file: SaveFile): SaveFile {
        // Cast via `unknown` because v1 saves legitimately predate the
        // `turnNumber` field on `BaseGameSnapshot`; the static `SaveFile`
        // type asserts the field is present, but a v1 input may not have it.
        // Widening to `Record<string, unknown>` lets us probe and add the
        // field safely without introducing `any`.
        const checkpoint = file.checkpoint as unknown as Record<string, unknown>;
        if ('turnNumber' in checkpoint) {
            return file;
        }
        return {
            ...file,
            checkpoint: { ...checkpoint, turnNumber: 0 } as SaveFile['checkpoint'],
        };
    },
};

/**
 * Migration from schema v2 to v3: ensure every checkpoint has a timers registry.
 *
 * Saves written before timers were introduced (and thus at v2 after the v1->v2
 * migration) should have timers: {} added as the default empty registry.
 * This ensures that `BaseGameSnapshot.timers` is never undefined after load
 * (Invariant #54, issue #407).
 *
 * Register this migration in the wiring point (`electron/main/index.ts`)
 * before the first call to `SaveMigrator.migrate()`.
 */
export const checkpointTimersMigration: SaveMigration = {
    fromVersion: 2,
    apply(file: SaveFile): SaveFile {
        // Cast via `unknown` because v2 saves legitimately predate the
        // `timers` field on `BaseGameSnapshot`; the static `SaveFile`
        // type asserts the field is present, but a v2 input may not have it.
        // Widening to `Record<string, unknown>` lets us probe and add the
        // field safely without introducing `any`.
        const checkpoint = file.checkpoint as unknown as Record<string, unknown>;
        if ('timers' in checkpoint && checkpoint['timers'] !== undefined) {
            return file;
        }
        return {
            ...file,
            checkpoint: { ...checkpoint, timers: {} } as SaveFile['checkpoint'],
        };
    },
};

/**
 * Returns a fresh `SaveMigrator` with all built-in schema migrations
 * pre-registered in order.
 *
 * Use this factory everywhere a migrator is needed (wiring point and tests)
 * so callers do not need to know which individual migrations exist.
 */
export function createDefaultMigrator(): SaveMigrator {
    const migrator = new SaveMigrator();
    migrator.register(checkpointTurnNumberMigration);
    migrator.register(checkpointTimersMigration);
    return migrator;
}
