/**
 * simulation/persistence/SaveMigrator.test.ts
 *
 * Tests for SaveMigrator, SaveMigration, SaveNotFoundError, and
 * SaveSchemaTooNewError (issue #121, §4.11).
 *
 * TDD cycle: these tests are written first — the source files do not yet
 * exist. All tests must be RED before implementation starts.
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no FS or Electron imports here.
 */

import { describe, expect, it } from 'vitest';
import {
    CURRENT_SCHEMA_VERSION,
    SaveMigrationError,
    SaveMigrator,
    SaveNotFoundError,
    SaveSchemaTooNewError,
} from './SaveMigrator.js';
import type { SaveFile } from './SaveFile.js';
import type { GamePhase } from '../engine/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFileAtVersion(schemaVersion: number): SaveFile {
    return {
        header: {
            schemaVersion,
            engineVersion: '0.1.0',
            gameId: 'tactics',
            gameVersion: '0.1.0',
            slotId: 'autosave',
            savedAt: 1_700_000_000_000,
            turnNumber: 1,
            playerNames: ['Alice'],
        },
        checkpoint: {
            tick: 1,
            seed: 42,
            players: {},
            entities: {},
            phase: 'playing' as GamePhase,
            events: [],
        },
        deltaActions: [],
        pendingCommitments: {},
    };
}

// ─── CURRENT_SCHEMA_VERSION ───────────────────────────────────────────────────

describe('CURRENT_SCHEMA_VERSION', () => {
    it('equals 1', () => {
        expect(CURRENT_SCHEMA_VERSION).toBe(1);
    });
});

// ─── SaveMigrator ─────────────────────────────────────────────────────────────

describe('SaveMigrator', () => {
    it('with zero registered migrations, returns the file unchanged for current version', () => {
        const migrator = new SaveMigrator();
        const file = makeFileAtVersion(CURRENT_SCHEMA_VERSION);

        expect(migrator.migrate(file)).toStrictEqual(file);
    });

    it('throws SaveSchemaTooNewError when file schemaVersion exceeds CURRENT_SCHEMA_VERSION', () => {
        const migrator = new SaveMigrator();
        const file = makeFileAtVersion(CURRENT_SCHEMA_VERSION + 1);

        expect(() => migrator.migrate(file)).toThrow(SaveSchemaTooNewError);
    });

    it('SaveSchemaTooNewError carries fileVersion and engineVersion', () => {
        const migrator = new SaveMigrator();
        const tooNew = CURRENT_SCHEMA_VERSION + 5;
        const file = makeFileAtVersion(tooNew);

        try {
            migrator.migrate(file);
            expect.fail('Expected SaveSchemaTooNewError');
        } catch (err) {
            expect(err).toBeInstanceOf(SaveSchemaTooNewError);
            const typed = err as SaveSchemaTooNewError;
            expect(typed.fileVersion).toBe(tooNew);
            expect(typed.engineVersion).toBe(CURRENT_SCHEMA_VERSION);
        }
    });

    // ── Invalid schema version ────────────────────────────────────────────────

    it('throws SaveMigrationError when schemaVersion is 0', () => {
        const migrator = new SaveMigrator();
        const file = makeFileAtVersion(0);

        expect(() => migrator.migrate(file)).toThrow(SaveMigrationError);
    });

    it('throws SaveMigrationError when schemaVersion is -1', () => {
        const migrator = new SaveMigrator();
        const file = makeFileAtVersion(-1);

        expect(() => migrator.migrate(file)).toThrow(SaveMigrationError);
    });

    it('throws SaveMigrationError when schemaVersion is NaN', () => {
        const migrator = new SaveMigrator();
        const file = makeFileAtVersion(NaN);

        expect(() => migrator.migrate(file)).toThrow(SaveMigrationError);
    });

    it('throws SaveMigrationError when schemaVersion is undefined cast to number', () => {
        const migrator = new SaveMigrator();
        const file = {
            ...makeFileAtVersion(1),
            header: {
                ...makeFileAtVersion(1).header,
                schemaVersion: undefined as unknown as number,
            },
        };

        expect(() => migrator.migrate(file)).toThrow(SaveMigrationError);
    });

    it('SaveMigrationError message includes the invalid version', () => {
        const migrator = new SaveMigrator();
        const file = makeFileAtVersion(-1);

        try {
            migrator.migrate(file);
            expect.fail('Expected SaveMigrationError');
        } catch (err) {
            expect(err).toBeInstanceOf(SaveMigrationError);
            expect((err as SaveMigrationError).message).toContain('-1');
        }
    });

    // ── Gap detection ─────────────────────────────────────────────────────────
    //
    // With CURRENT_SCHEMA_VERSION=1 the only valid input version is 1 (already
    // current), so the post-loop check "reached vX, expected vY" can only fire
    // when a spurious migration registered for fromVersion=1 overshoots the
    // target. That edge-case is tested below; a fuller gap test (e.g. v1→v2
    // exists but v2→v3 is missing while CURRENT=3) becomes possible once the
    // constant is bumped.

    it('throws SaveMigrationError when a registered migration causes the chain to overshoot CURRENT_SCHEMA_VERSION', () => {
        // A migration for fromVersion=CURRENT_SCHEMA_VERSION (1→2) is registered.
        // The file starts at v1, which passes all early guards. The migration
        // advances it to v2, but v2 ≠ CURRENT_SCHEMA_VERSION (1), so the
        // post-loop incomplete-chain check must throw.
        const migrator = new SaveMigrator();
        migrator.register({
            fromVersion: CURRENT_SCHEMA_VERSION,
            apply(file: SaveFile): SaveFile {
                return file;
            },
        });
        const file = makeFileAtVersion(CURRENT_SCHEMA_VERSION);

        expect(() => migrator.migrate(file)).toThrow(SaveMigrationError);
    });

    it('SaveMigrationError from post-loop check has a descriptive message', () => {
        const migrator = new SaveMigrator();
        migrator.register({
            fromVersion: CURRENT_SCHEMA_VERSION,
            apply(file: SaveFile): SaveFile {
                return file;
            },
        });
        const file = makeFileAtVersion(CURRENT_SCHEMA_VERSION);

        try {
            migrator.migrate(file);
            expect.fail('Expected SaveMigrationError');
        } catch (err) {
            expect(err).toBeInstanceOf(SaveMigrationError);
            const msg = (err as SaveMigrationError).message;
            expect(msg).toContain(String(CURRENT_SCHEMA_VERSION + 1));
            expect(msg).toContain(String(CURRENT_SCHEMA_VERSION));
        }
    });

    it('migrate() still accepts a file already at CURRENT_SCHEMA_VERSION without error', () => {
        const migrator = new SaveMigrator();
        const file = makeFileAtVersion(CURRENT_SCHEMA_VERSION);

        expect(() => migrator.migrate(file)).not.toThrow();
        expect(migrator.migrate(file)).toStrictEqual(file);
    });
});

// ─── SaveNotFoundError ────────────────────────────────────────────────────────

describe('SaveNotFoundError', () => {
    it('is an instanceof Error', () => {
        const err = new SaveNotFoundError('slot-1');

        expect(err).toBeInstanceOf(Error);
    });

    it('is an instanceof SaveNotFoundError', () => {
        const err = new SaveNotFoundError('slot-1');

        expect(err).toBeInstanceOf(SaveNotFoundError);
    });

    it('carries the slotId on the error', () => {
        const err = new SaveNotFoundError('tactics/autosave');

        expect(err.slotId).toBe('tactics/autosave');
    });

    it('has a descriptive message containing the slotId', () => {
        const err = new SaveNotFoundError('quicksave');

        expect(err.message).toContain('quicksave');
    });
});

// ─── SaveSchemaTooNewError ────────────────────────────────────────────────────

describe('SaveSchemaTooNewError', () => {
    it('is an instanceof Error', () => {
        const err = new SaveSchemaTooNewError(5, 1);

        expect(err).toBeInstanceOf(Error);
    });

    it('is an instanceof SaveSchemaTooNewError', () => {
        const err = new SaveSchemaTooNewError(5, 1);

        expect(err).toBeInstanceOf(SaveSchemaTooNewError);
    });

    it('carries fileVersion and engineVersion', () => {
        const err = new SaveSchemaTooNewError(7, 2);

        expect(err.fileVersion).toBe(7);
        expect(err.engineVersion).toBe(2);
    });

    it('has a descriptive message', () => {
        const err = new SaveSchemaTooNewError(5, 1);

        expect(err.message).toContain('5');
        expect(err.message).toContain('1');
    });
});

// ─── SaveMigrationError ───────────────────────────────────────────────────────

describe('SaveMigrationError', () => {
    it('is an instanceof Error', () => {
        const err = new SaveMigrationError('bad input');

        expect(err).toBeInstanceOf(Error);
    });

    it('is an instanceof SaveMigrationError', () => {
        const err = new SaveMigrationError('bad input');

        expect(err).toBeInstanceOf(SaveMigrationError);
    });

    it('carries the message supplied to the constructor', () => {
        const err = new SaveMigrationError('Invalid schema version: -1');

        expect(err.message).toBe('Invalid schema version: -1');
    });

    it('has name SaveMigrationError', () => {
        const err = new SaveMigrationError('any');

        expect(err.name).toBe('SaveMigrationError');
    });
});
