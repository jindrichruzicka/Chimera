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
    SaveMigrator,
    SaveNotFoundError,
    SaveSchemaTooNewError,
} from './SaveMigrator.js';
import type { SaveMigration } from './SaveMigrator.js';
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

    it('applies a v0 → v1 migration and returns file with schemaVersion 1', () => {
        const migrator = new SaveMigrator();
        const migration: SaveMigration = {
            fromVersion: 0,
            apply(file: SaveFile): SaveFile {
                return {
                    ...file,
                    header: {
                        ...file.header,
                        // Simulate a migration that adds a field to the header
                        gameVersion: '0.2.0',
                    },
                };
            },
        };
        migrator.register(migration);

        const file = makeFileAtVersion(0);
        const result = migrator.migrate(file);

        expect(result.header.schemaVersion).toBe(1);
        expect(result.header.gameVersion).toBe('0.2.0');
    });

    it('applies chained migrations v0 → v1 → v2 in order', () => {
        const migrator = new SaveMigrator();
        const applied: number[] = [];

        migrator.register({
            fromVersion: 0,
            apply(file: SaveFile): SaveFile {
                applied.push(0);
                return file;
            },
        });
        migrator.register({
            fromVersion: 1,
            apply(file: SaveFile): SaveFile {
                applied.push(1);
                return file;
            },
        });

        migrator.migrate(makeFileAtVersion(0));

        expect(applied).toStrictEqual([0, 1]);
    });

    it('applies migrations regardless of registration order (sorts by fromVersion)', () => {
        const migrator = new SaveMigrator();
        const applied: number[] = [];

        // Register in reverse order — migrator must sort before applying.
        migrator.register({
            fromVersion: 1,
            apply(file: SaveFile): SaveFile {
                applied.push(1);
                return file;
            },
        });
        migrator.register({
            fromVersion: 0,
            apply(file: SaveFile): SaveFile {
                applied.push(0);
                return file;
            },
        });

        migrator.migrate(makeFileAtVersion(0));

        expect(applied).toStrictEqual([0, 1]);
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

    it('does not mutate the input file', () => {
        const migrator = new SaveMigrator();
        migrator.register({
            fromVersion: 0,
            apply(file: SaveFile): SaveFile {
                return { ...file, header: { ...file.header, gameVersion: 'mutated' } };
            },
        });

        const original = makeFileAtVersion(0);
        migrator.migrate(original);

        expect(original.header.gameVersion).toBe('0.1.0');
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
