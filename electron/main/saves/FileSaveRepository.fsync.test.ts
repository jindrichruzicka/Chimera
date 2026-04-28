/**
 * electron/main/saves/FileSaveRepository.fsync.test.ts
 *
 * Isolated test that verifies FileSaveRepository.save() calls fh.sync()
 * before fs.rename() — invariant #23 (crash-atomic save on power loss).
 *
 * Uses vi.mock to intercept fs/promises so the call sequence can be observed
 * without touching the real filesystem for this invariant check.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    JsonSaveSerializer,
    createDefaultMigrator,
} from '@chimera/simulation/persistence/index.js';
import { makeFile } from '@chimera/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import { FileSaveRepository } from './FileSaveRepository.js';

// vi.hoisted creates the vi.fn() stubs before any import is evaluated so they
// can be referenced inside the vi.mock factory below.  Implementations are NOT
// set here because restoreMocks:true (vitest.config.mts) calls mockReset()
// before every test, which removes any implementation set at module level.
// Fresh implementations are applied in beforeEach() instead.
const mocks = vi.hoisted(() => ({
    callOrder: [] as string[],
    mockOpen: vi.fn(),
    mockRename: vi.fn(),
    mockMkdir: vi.fn(),
    mockWriteFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
    mkdir: mocks.mockMkdir,
    open: mocks.mockOpen,
    rename: mocks.mockRename,
    writeFile: mocks.mockWriteFile,
}));

// ── fsync ordering test ───────────────────────────────────────────────────────

describe('FileSaveRepository — fsync ordering (invariant #23)', () => {
    beforeEach(() => {
        // Reset call order.
        mocks.callOrder.length = 0;

        // Set up implementations fresh each test (restoreMocks:true would
        // otherwise have stripped them before this beforeEach runs).
        mocks.mockMkdir.mockResolvedValue(undefined);
        mocks.mockWriteFile.mockResolvedValue(undefined);
        mocks.mockRename.mockImplementation(() => {
            mocks.callOrder.push('rename');
            return Promise.resolve();
        });
        mocks.mockOpen.mockResolvedValue({
            writeFile: vi.fn().mockResolvedValue(undefined),
            sync: vi.fn().mockImplementation(() => {
                mocks.callOrder.push('sync');
                return Promise.resolve();
            }),
            close: vi.fn().mockResolvedValue(undefined),
        });
    });

    it('save() calls fh.sync() before fs.rename() to ensure bytes reach disk before rename', async () => {
        const repo = new FileSaveRepository(
            new JsonSaveSerializer(),
            createDefaultMigrator(),
            '/fake/base',
        );
        const file = makeFile('tactics', 'fsync-order');

        await repo.save(file);

        // sync must appear before rename so that the OS page-cache is flushed
        // to stable storage before the directory entry is updated.
        expect(mocks.callOrder).toStrictEqual(['sync', 'rename']);
    });
});
