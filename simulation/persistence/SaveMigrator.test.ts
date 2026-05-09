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
    checkpointMatchResultMigration,
    checkpointTurnNumberMigration,
    createDefaultMigrator,
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
            turnNumber: 0,
            timers: {},
            matchResult: null,
        },
        deltaActions: [],
        pendingCommitments: {},
    };
}

// ─── CURRENT_SCHEMA_VERSION ───────────────────────────────────────────────────

describe('CURRENT_SCHEMA_VERSION', () => {
    it('equals 4', () => {
        expect(CURRENT_SCHEMA_VERSION).toBe(4);
    });
});

// ─── checkpointTurnNumberMigration (v1 → v2) ─────────────────────────────────
//
// B1 from code review of eca8acb: the checkpoint schema must validate
// BaseGameSnapshot.turnNumber so that an old save (v1, no turnNumber field)
// is upgraded rather than being accepted with an implicit undefined.

describe('checkpointTurnNumberMigration (v1 → v2)', () => {
    it('is a SaveMigration with fromVersion 1', () => {
        expect(checkpointTurnNumberMigration.fromVersion).toBe(1);
    });

    it('sets checkpoint.turnNumber to 0 when the v1 file lacks the field', () => {
        // Simulate a v1 save file that predates turnNumber on BaseGameSnapshot.
        const v1File = makeFileAtVersion(1);
        // Cast to unknown so we can delete the field that did not exist in v1.
        const checkpointWithoutTurnNumber = { ...v1File.checkpoint } as Record<string, unknown>;
        delete checkpointWithoutTurnNumber['turnNumber'];
        const legacyFile = {
            ...v1File,
            checkpoint: checkpointWithoutTurnNumber,
        } as unknown as SaveFile;

        const upgraded = checkpointTurnNumberMigration.apply(legacyFile);

        expect((upgraded.checkpoint as unknown as Record<string, unknown>)['turnNumber']).toBe(0);
    });

    it('preserves an existing checkpoint.turnNumber when the field is already present', () => {
        const v1FileWithTurnNumber = makeFileAtVersion(1);
        // Already has turnNumber: 0 in the fixture.
        const upgraded = checkpointTurnNumberMigration.apply(v1FileWithTurnNumber);

        expect((upgraded.checkpoint as unknown as Record<string, unknown>)['turnNumber']).toBe(0);
    });

    it('does not mutate the input file', () => {
        const v1File = makeFileAtVersion(1);
        const originalCheckpoint = v1File.checkpoint;

        checkpointTurnNumberMigration.apply(v1File);

        expect(v1File.checkpoint).toBe(originalCheckpoint);
    });

    it('SaveMigrator applies the migration: v1 file without turnNumber is upgraded to v2 with turnNumber 0', () => {
        const migrator = createDefaultMigrator();

        const v1File = makeFileAtVersion(1);
        const checkpointWithoutTurnNumber = { ...v1File.checkpoint } as Record<string, unknown>;
        delete checkpointWithoutTurnNumber['turnNumber'];
        const legacyFile = {
            ...v1File,
            checkpoint: checkpointWithoutTurnNumber,
        } as unknown as SaveFile;

        const result = migrator.migrate(legacyFile);

        // After applying all migrations, file should be at v4
        expect(result.header.schemaVersion).toBe(4);
        expect((result.checkpoint as unknown as Record<string, unknown>)['turnNumber']).toBe(0);
        expect((result.checkpoint as unknown as Record<string, unknown>)['timers']).toStrictEqual(
            {},
        );
        expect((result.checkpoint as unknown as Record<string, unknown>)['matchResult']).toBeNull();
    });
});

// ─── checkpointMatchResultMigration (v3 → v4) ────────────────────────────────

describe('checkpointMatchResultMigration (v3 → v4)', () => {
    it('is a SaveMigration with fromVersion 3', () => {
        expect(checkpointMatchResultMigration.fromVersion).toBe(3);
    });

    it('sets checkpoint.matchResult to null when the v3 file lacks the field', () => {
        const v3File = makeFileAtVersion(3);
        const checkpointWithoutMatchResult = { ...v3File.checkpoint } as Record<string, unknown>;
        delete checkpointWithoutMatchResult['matchResult'];
        const legacyFile = {
            ...v3File,
            checkpoint: checkpointWithoutMatchResult,
        } as unknown as SaveFile;

        const upgraded = checkpointMatchResultMigration.apply(legacyFile);

        expect(
            (upgraded.checkpoint as unknown as Record<string, unknown>)['matchResult'],
        ).toBeNull();
    });

    it('preserves an existing non-null checkpoint.matchResult', () => {
        const v3File = {
            ...makeFileAtVersion(3),
            checkpoint: {
                ...makeFileAtVersion(3).checkpoint,
                matchResult: { winnerIds: [] },
            },
        };

        const upgraded = checkpointMatchResultMigration.apply(v3File);

        expect((upgraded.checkpoint as unknown as Record<string, unknown>)['matchResult']).toEqual({
            winnerIds: [],
        });
    });

    it('is idempotent once checkpoint.matchResult exists', () => {
        const v3File = makeFileAtVersion(3);

        const once = checkpointMatchResultMigration.apply(v3File);
        const twice = checkpointMatchResultMigration.apply(once);

        expect(twice).toStrictEqual(once);
    });

    it('SaveMigrator upgrades a v3 file without matchResult to v4 with matchResult null', () => {
        const migrator = createDefaultMigrator();
        const v3File = makeFileAtVersion(3);
        const checkpointWithoutMatchResult = { ...v3File.checkpoint } as Record<string, unknown>;
        delete checkpointWithoutMatchResult['matchResult'];
        const legacyFile = {
            ...v3File,
            checkpoint: checkpointWithoutMatchResult,
        } as unknown as SaveFile;

        const result = migrator.migrate(legacyFile);

        expect(result.header.schemaVersion).toBe(4);
        expect((result.checkpoint as unknown as Record<string, unknown>)['matchResult']).toBeNull();
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

    // ── Freeze-after-first-use ────────────────────────────────────────────────

    it('register() throws after migrate() has been called', () => {
        const migrator = new SaveMigrator();
        const file = makeFileAtVersion(CURRENT_SCHEMA_VERSION);

        migrator.migrate(file);

        expect(() =>
            migrator.register({
                fromVersion: 1,
                apply(f: SaveFile): SaveFile {
                    return f;
                },
            }),
        ).toThrow('Cannot register migrations after migrate() has been called');
    });

    it('register() does not throw before migrate() has been called', () => {
        const migrator = new SaveMigrator();

        expect(() =>
            migrator.register({
                fromVersion: 1,
                apply(f: SaveFile): SaveFile {
                    return f;
                },
            }),
        ).not.toThrow();
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
