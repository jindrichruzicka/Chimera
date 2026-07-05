/**
 * electron/main/session/FileSessionTicketStore.fsync.test.ts
 *
 * Isolated tests that verify FileSessionTicketStore.record() writes
 * crash-atomically: fh.sync() before fs.rename() (invariant #23), and the
 * `.tmp` artefact is unlinked when the rename fails.
 *
 * Uses vi.mock to intercept fs/promises so the call sequence can be observed
 * without touching the real filesystem for this invariant check.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTicket } from './__test-support__/sessionTicketStoreContractTests.js';
import { FileSessionTicketStore } from './FileSessionTicketStore.js';

// vi.hoisted creates the vi.fn() stubs before any import is evaluated so they
// can be referenced inside the vi.mock factory below.  Implementations are NOT
// set here because restoreMocks:true (vitest.config.mts) calls mockReset()
// before every test, which removes any implementation set at module level.
// Fresh implementations are applied in beforeEach() instead.
const mocks = vi.hoisted(() => ({
    callOrder: [] as string[],
    mockReadFile: vi.fn(),
    mockMkdir: vi.fn(),
    mockOpen: vi.fn(),
    mockRename: vi.fn(),
    mockUnlink: vi.fn(),
}));

vi.mock('fs/promises', () => ({
    readFile: mocks.mockReadFile,
    mkdir: mocks.mockMkdir,
    open: mocks.mockOpen,
    rename: mocks.mockRename,
    unlink: mocks.mockUnlink,
}));

describe('FileSessionTicketStore — atomic write (invariant #23)', () => {
    beforeEach(() => {
        mocks.callOrder.length = 0;

        const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        mocks.mockReadFile.mockRejectedValue(enoent);
        mocks.mockMkdir.mockResolvedValue(undefined);
        mocks.mockUnlink.mockResolvedValue(undefined);
        mocks.mockRename.mockImplementation(() => {
            mocks.callOrder.push('rename');
            return Promise.resolve();
        });
        mocks.mockOpen.mockImplementation(() => {
            mocks.callOrder.push('open');
            return Promise.resolve({
                writeFile: vi.fn().mockImplementation(() => {
                    mocks.callOrder.push('writeFile');
                    return Promise.resolve();
                }),
                sync: vi.fn().mockImplementation(() => {
                    mocks.callOrder.push('sync');
                    return Promise.resolve();
                }),
                close: vi.fn().mockImplementation(() => {
                    mocks.callOrder.push('close');
                    return Promise.resolve();
                }),
            });
        });
    });

    it('record() writes to .tmp, syncs, closes, then renames', async () => {
        const store = new FileSessionTicketStore('/fake/session-tickets.json');

        await store.record(makeTicket('match-a'));

        expect(mocks.callOrder).toStrictEqual(['open', 'writeFile', 'sync', 'close', 'rename']);
        expect(mocks.mockOpen).toHaveBeenCalledWith('/fake/session-tickets.json.tmp', 'w');
        expect(mocks.mockRename).toHaveBeenCalledWith(
            '/fake/session-tickets.json.tmp',
            '/fake/session-tickets.json',
        );
    });

    it('record() unlinks the .tmp artefact and rethrows when rename fails', async () => {
        const store = new FileSessionTicketStore('/fake/session-tickets.json');
        const renameError = new Error('EXDEV: cross-device rename');
        mocks.mockRename.mockRejectedValue(renameError);

        await expect(store.record(makeTicket('match-a'))).rejects.toThrow(renameError);

        expect(mocks.mockUnlink).toHaveBeenCalledWith('/fake/session-tickets.json.tmp');
    });
});
