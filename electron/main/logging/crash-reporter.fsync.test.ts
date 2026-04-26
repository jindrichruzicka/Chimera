/**
 * electron/main/crash-reporter.fsync.test.ts
 *
 * Isolated test that verifies writeCrashDump calls fs.fsyncSync() between
 * fs.writeSync() and fs.renameSync() — Invariant #68 (crash dump must be
 * durably written before the atomic rename completes).
 *
 * Uses vi.hoisted + vi.mock to intercept node:fs so the call sequence can be
 * observed without touching the real filesystem for this invariant check.
 * This pattern mirrors the precedent in FileSaveRepository.fsync.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from './logger.js';
import type { CrashReporterOptions } from './crash-reporter.js';

// vi.hoisted creates stubs before any import is evaluated so they can be
// referenced inside the vi.mock factory below.
const mocks = vi.hoisted(() => ({
    callOrder: [] as string[],
    mockMkdirSync: vi.fn<(path: string, opts?: unknown) => void>(),
    mockOpenSync: vi.fn<(path: string, flags: string) => number>(),
    mockWriteSync: vi.fn<(fd: number, data: string, pos: null, enc: string) => number>(),
    mockFsyncSync: vi.fn<(fd: number) => void>(),
    mockCloseSync: vi.fn<(fd: number) => void>(),
    mockRenameSync: vi.fn<(src: string, dst: string) => void>(),
}));

vi.mock('node:fs', () => ({
    mkdirSync: mocks.mockMkdirSync,
    openSync: mocks.mockOpenSync,
    writeSync: mocks.mockWriteSync,
    fsyncSync: mocks.mockFsyncSync,
    closeSync: mocks.mockCloseSync,
    renameSync: mocks.mockRenameSync,
    // These are used by crash-reporter but not under test here.
    existsSync: vi.fn(() => false),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): Logger {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(function (this: Logger) {
            return this;
        }),
    };
}

type ProcessEventName = 'uncaughtException' | 'unhandledRejection';

interface FakeProcess {
    on(event: ProcessEventName, handler: (...args: readonly unknown[]) => void): void;
    exit(code?: number): void;
    _emit(event: ProcessEventName, ...args: readonly unknown[]): void;
}

function makeProcess(): FakeProcess {
    const handlers = new Map<string, (...args: readonly unknown[]) => void>();
    return {
        on(event, handler) {
            handlers.set(event, handler);
        },
        exit: vi.fn(),
        _emit(event, ...args) {
            handlers.get(event)?.(...args);
        },
    };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('crash-reporter writeCrashDump — fsync ordering (Invariant #68)', () => {
    beforeEach(() => {
        mocks.callOrder.length = 0;

        mocks.mockMkdirSync.mockImplementation(() => undefined);
        mocks.mockOpenSync.mockReturnValue(99);
        mocks.mockWriteSync.mockImplementation(() => {
            mocks.callOrder.push('writeSync');
            return 0;
        });
        mocks.mockFsyncSync.mockImplementation(() => {
            mocks.callOrder.push('fsyncSync');
        });
        mocks.mockCloseSync.mockImplementation(() => undefined);
        mocks.mockRenameSync.mockImplementation(() => {
            mocks.callOrder.push('renameSync');
        });
    });

    it('fsyncSync is called between writeSync and renameSync (Invariant #68)', async () => {
        const { registerCrashReporter } = await import('./crash-reporter.js');

        const logger = makeLogger();
        const proc = makeProcess();

        const options: CrashReporterOptions = {
            logger,
            crashesDir: '/fake/crashes',
            getSnapshot: () => null,
            autosave: vi.fn(() => Promise.resolve()),
            process: proc as unknown as NodeJS.Process,
        };

        registerCrashReporter(options);
        proc._emit('uncaughtException', new Error('fsync ordering test'));

        await new Promise((r) => setTimeout(r, 100));

        expect(mocks.mockFsyncSync).toHaveBeenCalledOnce();
        expect(mocks.mockFsyncSync).toHaveBeenCalledWith(99);

        const writeIdx = mocks.callOrder.indexOf('writeSync');
        const fsyncIdx = mocks.callOrder.indexOf('fsyncSync');
        const renameIdx = mocks.callOrder.indexOf('renameSync');

        // Invariant: writeSync → fsyncSync → renameSync (data must reach disk
        // before the directory entry is updated via rename).
        expect(writeIdx).toBeGreaterThanOrEqual(0);
        expect(fsyncIdx).toBeGreaterThan(writeIdx);
        expect(renameIdx).toBeGreaterThan(fsyncIdx);
    });
});
