/**
 * electron/main/saves/FileSaveRepository.errors.test.ts
 *
 * Tests that non-ENOENT filesystem errors (EACCES, EIO, EMFILE, etc.) are
 * propagated rather than swallowed (issue #135 / WARN-5).
 *
 * Uses vi.mock('fs/promises') so that individual methods can be made to
 * throw controlled errors — ESM module namespaces are not configurable, so
 * vi.spyOn cannot be used here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    JsonSaveSerializer,
    createDefaultMigrator,
    SaveNotFoundError,
} from '@chimera/simulation/persistence/index.js';
import { FileSaveRepository } from './FileSaveRepository.js';

// vi.hoisted runs before any imports are evaluated so the stubs exist when
// the vi.mock factory below references them.
const mocks = vi.hoisted(() => ({
    mockReadFile: vi.fn(),
    mockReaddir: vi.fn(),
    mockUnlink: vi.fn(),
    mockAccess: vi.fn(),
    mockMkdir: vi.fn(),
    mockStat: vi.fn(),
    mockRm: vi.fn(),
    mockOpen: vi.fn(),
    mockRename: vi.fn(),
    mockWriteFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
    readFile: mocks.mockReadFile,
    readdir: mocks.mockReaddir,
    unlink: mocks.mockUnlink,
    access: mocks.mockAccess,
    mkdir: mocks.mockMkdir,
    stat: mocks.mockStat,
    rm: mocks.mockRm,
    open: mocks.mockOpen,
    rename: mocks.mockRename,
    writeFile: mocks.mockWriteFile,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEacces(): NodeJS.ErrnoException {
    return Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
}

function makeEnoent(filePath: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), {
        code: 'ENOENT',
    });
}

function makeRepo(): FileSaveRepository {
    return new FileSaveRepository(new JsonSaveSerializer(), createDefaultMigrator(), '/fake/base');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FileSaveRepository — non-ENOENT FS errors are propagated, not swallowed', () => {
    // restoreMocks:true (vitest.config.mts) resets mock implementations before
    // each test; set them explicitly in beforeEach.
    beforeEach(() => {
        mocks.mockMkdir.mockResolvedValue(undefined);
        mocks.mockRm.mockResolvedValue(undefined);
    });

    describe('load()', () => {
        it('re-throws EACCES instead of wrapping in SaveNotFoundError', async () => {
            mocks.mockReadFile.mockRejectedValueOnce(makeEacces());
            const repo = makeRepo();

            const err = await repo.load('tactics/autosave').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(SaveNotFoundError);
            expect((err as NodeJS.ErrnoException).code).toBe('EACCES');
        });

        it('still throws SaveNotFoundError for ENOENT', async () => {
            mocks.mockReadFile.mockRejectedValueOnce(
                makeEnoent('/fake/base/tactics/autosave.chimera'),
            );
            const repo = makeRepo();

            await expect(repo.load('tactics/autosave')).rejects.toBeInstanceOf(SaveNotFoundError);
        });
    });

    describe('delete()', () => {
        it('re-throws EACCES instead of wrapping in SaveNotFoundError', async () => {
            mocks.mockUnlink.mockRejectedValueOnce(makeEacces());
            const repo = makeRepo();

            const err = await repo.delete('tactics/autosave').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(SaveNotFoundError);
            expect((err as NodeJS.ErrnoException).code).toBe('EACCES');
        });

        it('still throws SaveNotFoundError for ENOENT', async () => {
            mocks.mockUnlink.mockRejectedValueOnce(
                makeEnoent('/fake/base/tactics/autosave.chimera'),
            );
            const repo = makeRepo();

            await expect(repo.delete('tactics/autosave')).rejects.toBeInstanceOf(SaveNotFoundError);
        });
    });

    describe('list()', () => {
        it('re-throws EACCES instead of returning []', async () => {
            mocks.mockReaddir.mockRejectedValueOnce(makeEacces());
            const repo = makeRepo();

            const err = await repo.list('tactics').catch((e: unknown) => e);

            expect((err as NodeJS.ErrnoException).code).toBe('EACCES');
        });

        it('still returns [] for ENOENT (directory does not exist)', async () => {
            mocks.mockReaddir.mockRejectedValueOnce(makeEnoent('/fake/base/tactics'));
            const repo = makeRepo();

            await expect(repo.list('tactics')).resolves.toStrictEqual([]);
        });
    });

    describe('has()', () => {
        it('re-throws EACCES instead of returning false', async () => {
            mocks.mockAccess.mockRejectedValueOnce(makeEacces());
            const repo = makeRepo();

            const err = await repo.has('tactics/autosave').catch((e: unknown) => e);

            expect(err).not.toBe(false);
            expect((err as NodeJS.ErrnoException).code).toBe('EACCES');
        });

        it('still returns false for ENOENT', async () => {
            mocks.mockAccess.mockRejectedValueOnce(
                makeEnoent('/fake/base/tactics/autosave.chimera'),
            );
            const repo = makeRepo();

            await expect(repo.has('tactics/autosave')).resolves.toBe(false);
        });
    });
});
