/**
 * simulation/replay/ReplayMigrator.ts
 *
 * Cross-version compatibility guard for stored replays (§4.28), mirroring the
 * `SaveMigrator` pattern (§4.11) but keyed on the
 * `(formatVersion, engineVersion, gameId, gameVersion)` identity rather than a
 * single schema integer.
 *
 * A replay is compatible only when its `formatVersion` is the one this build
 * understands AND its `(engineVersion, gameVersion)` match the running engine's
 * installed versions for that `gameId`. Otherwise the migrator applies a
 * registered migration whose `from` triple matches the file, repeating until
 * the file is compatible. When no migration covers the file it throws
 * `ReplayVersionError`.
 *
 * For 1.0.0 no migrations are registered, so any mismatch throws — replays
 * recorded on a different engine/game version must be played on an archived
 * build.
 *
 * Architecture reference: §4.28
 *
 * Invariants upheld:
 *   #2  — simulation/ is side-effect-free; no FS or Electron imports.
 *   #71 — replay files carry the full identity triple; load rejects mismatches.
 */

import type { ReplayFile } from './ReplayFile.js';

/** The single `formatVersion` this engine build understands. */
export const SUPPORTED_FORMAT_VERSION = 1 as const;

// ─── Identity & target ────────────────────────────────────────────────────────

/**
 * The version identity stamped into a replay at record time.
 */
export interface ReplayVersionTriple {
    readonly engineVersion: string;
    readonly gameId: string;
    readonly gameVersion: string;
}

/**
 * The running engine's compatibility target for a specific replay. `gameVersion`
 * is the installed version of the replay's `gameId`, or `undefined` when that
 * game is not installed in the running engine (always incompatible).
 */
export interface ReplayCompatibilityTarget {
    readonly engineVersion: string;
    readonly gameVersion: string | undefined;
}

// ─── ReplayMigration ──────────────────────────────────────────────────────────

/**
 * A single migration step. `from` is the file identity this migration reads;
 * `apply` returns a new file with an updated identity (closer to compatible).
 * Implementations must not mutate the input file.
 */
export interface ReplayMigration {
    readonly from: ReplayVersionTriple;
    apply(file: ReplayFile): ReplayFile;
}

// ─── ReplayVersionError ───────────────────────────────────────────────────────

/**
 * Thrown by `ReplayManager.load()` (via `ReplayMigrator.ensureCompatible`) when
 * a replay's identity is incompatible with the running engine and no registered
 * migration covers it.
 *
 * Covers OWASP A08 (Software and Data Integrity Failures): a replay from an
 * unknown engine/game version is never silently played.
 */
export class ReplayVersionError extends Error {
    /** The file's identity triple plus its `formatVersion`. */
    public readonly actual: ReplayVersionTriple & { readonly formatVersion: number };
    /** The running engine's expected identity for this replay. */
    public readonly expected: ReplayVersionTriple;

    constructor(
        actual: ReplayVersionTriple & { readonly formatVersion: number },
        expected: ReplayVersionTriple,
    ) {
        super(
            `Replay is incompatible with the running engine: ` +
                `file (format v${String(actual.formatVersion)}, engine ${actual.engineVersion}, ` +
                `game ${actual.gameId}@${actual.gameVersion}) ` +
                `vs engine (format v${String(SUPPORTED_FORMAT_VERSION)}, engine ${expected.engineVersion}, ` +
                `game ${expected.gameId}@${expected.gameVersion}). ` +
                `No migrator is registered for this version.`,
        );
        this.name = 'ReplayVersionError';
        this.actual = actual;
        this.expected = expected;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── ReplayMigrator ───────────────────────────────────────────────────────────

/**
 * Applies registered migrations when loading a replay whose identity differs
 * from the running engine. Migrations are registered with `register()` before
 * the first `ensureCompatible()` call, after which the chain is frozen.
 */
export class ReplayMigrator {
    private readonly migrations: ReplayMigration[] = [];
    private frozen = false;

    /**
     * Register a migration step. Registration order is irrelevant — the
     * applicable migration is selected by matching the file's identity.
     *
     * @throws {Error} if called after `ensureCompatible()` has been invoked.
     */
    register(migration: ReplayMigration): void {
        if (this.frozen) {
            throw new Error(
                'Cannot register replay migrations after ensureCompatible() has been called',
            );
        }
        this.migrations.push(migration);
    }

    /**
     * Return `file` unchanged when it is already compatible with `target`.
     * Otherwise apply registered migrations (chain-of-responsibility) until the
     * file is compatible, or throw `ReplayVersionError` when no migration
     * advances it. The input file is never mutated.
     */
    ensureCompatible(file: ReplayFile, target: ReplayCompatibilityTarget): ReplayFile {
        if (!this.frozen) {
            Object.freeze(this.migrations);
            this.frozen = true;
        }

        let current = file;
        // Bound the loop by the number of registered migrations: each migration
        // may be applied at most once, so the chain cannot exceed that length.
        for (let step = 0; step <= this.migrations.length; step++) {
            if (ReplayMigrator.isCompatible(current, target)) {
                return current;
            }

            const migration = this.migrations.find((m) =>
                ReplayMigrator.tripleMatches(m.from, current),
            );
            if (migration === undefined) {
                break;
            }
            current = migration.apply(current);
        }

        throw new ReplayVersionError(
            {
                formatVersion: current.formatVersion,
                engineVersion: current.engineVersion,
                gameId: current.gameId,
                gameVersion: current.gameVersion,
            },
            {
                engineVersion: target.engineVersion,
                gameId: current.gameId,
                gameVersion: target.gameVersion ?? '(not installed)',
            },
        );
    }

    private static isCompatible(file: ReplayFile, target: ReplayCompatibilityTarget): boolean {
        return (
            file.formatVersion === SUPPORTED_FORMAT_VERSION &&
            file.engineVersion === target.engineVersion &&
            target.gameVersion !== undefined &&
            file.gameVersion === target.gameVersion
        );
    }

    private static tripleMatches(triple: ReplayVersionTriple, file: ReplayFile): boolean {
        return (
            triple.engineVersion === file.engineVersion &&
            triple.gameId === file.gameId &&
            triple.gameVersion === file.gameVersion
        );
    }
}
