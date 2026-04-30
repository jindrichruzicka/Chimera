/**
 * simulation/persistence/__tests__/SaveRepository.contract.test.ts
 *
 * Shared SaveRepository contract test suite parameterised over every
 * `SaveRepository` implementation (§4.11, invariant #41).
 *
 * Tests are authored here first (TDD — red before implementation); the same
 * `runSaveRepositoryContractTests` helper is invoked from
 * `electron/main/saves/FileSaveRepository.test.ts` for `FileSaveRepository`,
 * satisfying acceptance criterion #2 ("both impls pass the same suite").
 *
 * Invariants upheld:
 *   #2  — simulation/ is side-effect-free; no FS or Electron imports.
 *   #41 — InMemorySaveRepository passes the identical contract suite as
 *           FileSaveRepository.
 *   #23 — atomic-write contract (`.tmp` rename) is verified for
 *           FileSaveRepository in electron/main/saves/FileSaveRepository.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { InMemorySaveRepository } from '../InMemorySaveRepository.js';
import {
    runSaveRepositoryContractTests,
    makeFile,
} from '../__test-support__/saveRepositoryContractTests.js';
import {
    SaveSchemaTooNewError,
    SaveNotFoundError,
    CURRENT_SCHEMA_VERSION,
} from '../SaveMigrator.js';

// ── InMemorySaveRepository — full shared contract ──────────────────────────────
//
// FileSaveRepository runs the identical suite in:
//   electron/main/saves/FileSaveRepository.test.ts
// (invariant #41 — both impls must pass the same contract with zero skips).

runSaveRepositoryContractTests('InMemorySaveRepository', () => new InMemorySaveRepository());

// ── SaveSchemaTooNewError — error contract ─────────────────────────────────────
//
// FileSaveRepository.load() propagates this error from SaveMigrator when a
// save was written by a newer engine version. Verify that the error type is
// exported, constructible, and carries the expected properties so that
// callers can pattern-match on it safely.

describe('SaveSchemaTooNewError — error contract', () => {
    it('is an instance of Error', () => {
        const err = new SaveSchemaTooNewError(CURRENT_SCHEMA_VERSION + 1, CURRENT_SCHEMA_VERSION);

        expect(err).toBeInstanceOf(Error);
    });

    it('is an instance of SaveSchemaTooNewError', () => {
        const err = new SaveSchemaTooNewError(CURRENT_SCHEMA_VERSION + 1, CURRENT_SCHEMA_VERSION);

        expect(err).toBeInstanceOf(SaveSchemaTooNewError);
    });

    it('carries fileVersion and engineVersion on the error object', () => {
        const fileVersion = CURRENT_SCHEMA_VERSION + 5;
        const engineVersion = CURRENT_SCHEMA_VERSION;
        const err = new SaveSchemaTooNewError(fileVersion, engineVersion);

        expect(err.fileVersion).toBe(fileVersion);
        expect(err.engineVersion).toBe(engineVersion);
    });

    it('has a message that mentions both versions', () => {
        const fileVersion = CURRENT_SCHEMA_VERSION + 3;
        const engineVersion = CURRENT_SCHEMA_VERSION;
        const err = new SaveSchemaTooNewError(fileVersion, engineVersion);

        expect(err.message).toContain(String(fileVersion));
        expect(err.message).toContain(String(engineVersion));
    });

    it('name is SaveSchemaTooNewError', () => {
        const err = new SaveSchemaTooNewError(CURRENT_SCHEMA_VERSION + 1, CURRENT_SCHEMA_VERSION);

        expect(err.name).toBe('SaveSchemaTooNewError');
    });
});

// ── InMemorySaveRepository — save+list round-trip (explicit) ──────────────────
//
// These tests make the save+list contract explicit at this file level so the
// acceptance criterion "contract suite contains: save+list, load, delete+
// SaveNotFoundError, has" is directly visible here (the shared helper also
// covers all of these, but the explicit cases below serve as documentation).

describe('InMemorySaveRepository — save + list round-trip', () => {
    it('list returns a meta entry immediately after save', async () => {
        const repo = new InMemorySaveRepository();
        const file = makeFile('tactics', 'autosave');

        await repo.save(file);
        const slots = await repo.list('tactics');

        expect(slots).toHaveLength(1);
        expect(slots[0]?.slotId).toBe('tactics/autosave');
        expect(slots[0]?.gameId).toBe('tactics');
    });

    it('load returns the exact file that was saved', async () => {
        const repo = new InMemorySaveRepository();
        const file = makeFile('tactics', 'slot-1');

        await repo.save(file);
        const loaded = await repo.load('tactics/slot-1');

        expect(loaded).toMatchObject(file);
    });

    it('has returns true after save and false before', async () => {
        const repo = new InMemorySaveRepository();

        expect(await repo.has('tactics/autosave')).toBe(false);

        await repo.save(makeFile('tactics', 'autosave'));

        expect(await repo.has('tactics/autosave')).toBe(true);
    });

    it('delete removes the slot and throws SaveNotFoundError on a second delete', async () => {
        const repo = new InMemorySaveRepository();
        await repo.save(makeFile('tactics', 'autosave'));

        await repo.delete('tactics/autosave');

        expect(await repo.list('tactics')).toHaveLength(0);
        await expect(repo.delete('tactics/autosave')).rejects.toBeInstanceOf(SaveNotFoundError);
    });
});
