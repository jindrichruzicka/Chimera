import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LogEntry } from '@chimera-engine/simulation/foundation/logging.js';
import type { Logger } from './logger.js';
import { LogRingBufferSink } from './log-ring-buffer-sink.js';
import {
    type CrashReporterOptions,
    MAX_CRASH_LOG_ENTRIES,
    makeRendererGoneHandler,
    registerCrashReporter,
} from './crash-reporter.js';

// ── helpers ──────────────────────────────────────────────────────────────────

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
type AppEventName = 'before-quit';

interface FakeProcess {
    on(event: ProcessEventName, handler: (...args: readonly unknown[]) => void): void;
    exit(code?: number): void;
    _emit(event: ProcessEventName, ...args: readonly unknown[]): void;
}

interface FakeApp {
    on(event: AppEventName, handler: (...args: readonly unknown[]) => void): void;
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

function makeApp(): FakeApp {
    return {
        on: vi.fn(),
    };
}

function makeLogEntry(message: string, timestamp: number): LogEntry {
    return {
        level: 'info',
        message,
        timestamp,
        source: { process: 'main', module: 'test' },
    };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('constants', () => {
    it('MAX_CRASH_LOG_ENTRIES equals 1000 (architecture §4.27: "Last 1000 log entries")', () => {
        expect(MAX_CRASH_LOG_ENTRIES).toBe(1000);
    });
});

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chimera-crash-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('registerCrashReporter', () => {
    it('writes a crash dump JSON file on uncaughtException', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();
        const autosave = vi.fn<() => Promise<void>>(() => Promise.resolve());
        const options: CrashReporterOptions = {
            logger,
            crashesDir: path.join(tmpDir, 'crashes'),
            getSnapshot: () => null,
            autosave,
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        proc._emit('uncaughtException', new Error('test crash'));

        // Allow async autosave to complete
        await new Promise((r) => setTimeout(r, 50));

        const files = fs.readdirSync(path.join(tmpDir, 'crashes'));
        const dumpFile = files.find((f) => f.startsWith('crash-') && f.endsWith('.json'));
        expect(dumpFile).toBeDefined();
        expect(proc.exit).toHaveBeenCalledWith(1);
    });

    it('writes the crash dump atomically — final .json exists and no .tmp remains', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();
        const crashesDir = path.join(tmpDir, 'crashes');

        const options: CrashReporterOptions = {
            logger,
            crashesDir,
            getSnapshot: () => null,
            autosave: vi.fn(() => Promise.resolve()),
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        proc._emit('uncaughtException', new Error('atomic test'));

        await new Promise((r) => setTimeout(r, 50));

        const files = fs.readdirSync(crashesDir);
        const jsonFiles = files.filter((f) => f.endsWith('.json'));
        const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
        expect(jsonFiles.length).toBeGreaterThanOrEqual(1);
        expect(tmpFiles.length).toBe(0); // no leftover .tmp after atomic rename
        expect(proc.exit).toHaveBeenCalledWith(1);
    });

    it('calls autosave before writing the crash dump', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();
        const crashesDir = path.join(tmpDir, 'crashes');
        let autosaveCalled = false;
        // Use getSnapshot to detect whether the dump was already written when autosave runs;
        // if autosave fires BEFORE the dump file exists, we know the order is correct.
        let dumpExistedAtAutosaveTime = false;
        const autosave = vi.fn<() => Promise<void>>(async () => {
            autosaveCalled = true;
            await Promise.resolve(); // explicit await to satisfy @typescript-eslint/require-await
            if (fs.existsSync(crashesDir)) {
                const files = fs.readdirSync(crashesDir);
                dumpExistedAtAutosaveTime = files.some((f) => f.endsWith('.json'));
            }
        });

        const options: CrashReporterOptions = {
            logger,
            crashesDir,
            getSnapshot: () => ({ tick: 1 }),
            autosave,
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        proc._emit('uncaughtException', new Error('order test'));

        await new Promise((r) => setTimeout(r, 100));

        expect(autosaveCalled).toBe(true);
        // Dump must NOT exist yet when autosave runs
        expect(dumpExistedAtAutosaveTime).toBe(false);
        // But dump must exist after everything settles
        const files = fs.readdirSync(crashesDir);
        expect(files.some((f) => f.endsWith('.json'))).toBe(true);
        expect(proc.exit).toHaveBeenCalledWith(1);
    });

    it('unhandledRejection does NOT call process.exit', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();

        const options: CrashReporterOptions = {
            logger,
            crashesDir: path.join(tmpDir, 'crashes'),
            getSnapshot: () => null,
            autosave: vi.fn(() => Promise.resolve()),
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        proc._emit('unhandledRejection', new Error('rejection'), Promise.resolve());

        await new Promise((r) => setTimeout(r, 50));

        expect(proc.exit).not.toHaveBeenCalled();
    });

    it('logs at fatal on uncaughtException', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();

        const options: CrashReporterOptions = {
            logger,
            crashesDir: path.join(tmpDir, 'crashes'),
            getSnapshot: () => null,
            autosave: vi.fn(() => Promise.resolve()),
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        const err = new Error('fatal test');
        proc._emit('uncaughtException', err);

        await new Promise((r) => setTimeout(r, 50));

        expect(logger.fatal).toHaveBeenCalledWith(
            expect.stringContaining('uncaughtException'),
            err,
            expect.anything(),
        );
        expect(proc.exit).toHaveBeenCalledWith(1);
    });

    it('logs at error on unhandledRejection', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();

        const options: CrashReporterOptions = {
            logger,
            crashesDir: path.join(tmpDir, 'crashes'),
            getSnapshot: () => null,
            autosave: vi.fn(() => Promise.resolve()),
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        proc._emit('unhandledRejection', new Error('rej'), Promise.resolve());

        await new Promise((r) => setTimeout(r, 50));

        expect(logger.error).toHaveBeenCalled();
    });

    it('calls proc.exit(1) even when autosave rejects', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();

        const options: CrashReporterOptions = {
            logger,
            crashesDir: path.join(tmpDir, 'crashes'),
            getSnapshot: () => null,
            autosave: vi.fn(() => Promise.reject(new Error('autosave blew up'))),
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        proc._emit('uncaughtException', new Error('crash with bad autosave'));

        await new Promise((r) => setTimeout(r, 100));

        expect(proc.exit).toHaveBeenCalledWith(1);
    });

    it('calls proc.exit(1) even when writeCrashDump throws (unwritable crashesDir)', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();
        // Use a path that will cause writeCrashDump to fail:
        // create a file where the directory should be so mkdirSync throws
        const badCrashesDir = path.join(tmpDir, 'not-a-dir');
        fs.writeFileSync(badCrashesDir, 'I am a file, not a directory');

        const options: CrashReporterOptions = {
            logger,
            crashesDir: badCrashesDir,
            getSnapshot: () => null,
            autosave: vi.fn(() => Promise.resolve()),
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        proc._emit('uncaughtException', new Error('crash with bad dump path'));

        await new Promise((r) => setTimeout(r, 100));

        expect(proc.exit).toHaveBeenCalledWith(1);
    });

    it('calls the flush option before proc.exit on uncaughtException', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();
        const flushOrder: string[] = [];

        const flush = vi.fn(() => {
            flushOrder.push('flush');
        });

        // Capture exit order
        const exitSpy = vi.spyOn(proc, 'exit').mockImplementation(() => {
            flushOrder.push('exit');
        });

        const options: CrashReporterOptions = {
            logger,
            crashesDir: path.join(tmpDir, 'crashes'),
            getSnapshot: () => null,
            autosave: vi.fn(() => Promise.resolve()),
            process: proc as unknown as NodeJS.Process,
            app,
            flush,
        };

        registerCrashReporter(options);
        proc._emit('uncaughtException', new Error('flush test'));

        await new Promise((r) => setTimeout(r, 100));

        expect(flush).toHaveBeenCalledOnce();
        // flush must happen BEFORE exit
        expect(flushOrder.indexOf('flush')).toBeLessThan(flushOrder.indexOf('exit'));
        exitSpy.mockRestore();
    });

    it('writes appVersion and recentLogs into the crash dump JSON', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();
        const crashesDir = path.join(tmpDir, 'crashes');
        const ring = new LogRingBufferSink({ write: vi.fn() }, 2);
        ring.write(makeLogEntry('first', 1));
        ring.write(makeLogEntry('second', 2));
        ring.write(makeLogEntry('third', 3));

        const options: CrashReporterOptions = {
            logger,
            crashesDir,
            getSnapshot: () => null,
            getRecentLogs: () => ring.drain(),
            getAppVersion: () => '0.7.0-test',
            autosave: vi.fn(() => Promise.resolve()),
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        proc._emit('uncaughtException', new Error('complete dump test'));

        await new Promise((r) => setTimeout(r, 50));

        const files = fs.readdirSync(crashesDir);
        const dumpFile = files.find((f) => f.startsWith('crash-') && f.endsWith('.json'));
        expect(dumpFile).toBeDefined();
        const dump = JSON.parse(fs.readFileSync(path.join(crashesDir, dumpFile!), 'utf-8')) as {
            readonly appVersion?: unknown;
            readonly error?: { readonly name?: unknown; readonly message?: unknown };
            readonly osRelease?: unknown;
            readonly recentLogs?: readonly LogEntry[];
            readonly snapshot?: unknown;
            readonly timestamp?: unknown;
            readonly versions?: { readonly node?: unknown };
        };

        expect(dump.appVersion).toBe('0.7.0-test');
        expect(dump.error).toEqual(
            expect.objectContaining({ name: 'Error', message: 'complete dump test' }),
        );
        expect(typeof dump.osRelease).toBe('string');
        expect(Array.isArray(dump.recentLogs)).toBe(true);
        expect(dump.recentLogs?.map((entry) => entry.message)).toEqual(['second', 'third']);
        expect(dump.recentLogs?.length).toBeLessThanOrEqual(2);
        expect(dump.snapshot).toBeNull();
        expect(typeof dump.timestamp).toBe('string');
        expect(dump.versions?.node).toEqual(expect.any(String));
    });

    it('caps recentLogs at MAX_CRASH_LOG_ENTRIES, keeping the most recent entries', async () => {
        const logger = makeLogger();
        const proc = makeProcess();
        const app = makeApp();
        const crashesDir = path.join(tmpDir, 'crashes');
        const totalEntries = MAX_CRASH_LOG_ENTRIES + 1;
        const allEntries = Array.from({ length: totalEntries }, (_, i) =>
            makeLogEntry(`msg-${i}`, i),
        );

        const options: CrashReporterOptions = {
            logger,
            crashesDir,
            getSnapshot: () => null,
            getRecentLogs: () => allEntries,
            getAppVersion: () => '0.7.0-test',
            autosave: vi.fn(() => Promise.resolve()),
            process: proc as unknown as NodeJS.Process,
            app,
        };

        registerCrashReporter(options);
        proc._emit('uncaughtException', new Error('cap test'));

        await new Promise((r) => setTimeout(r, 50));

        const files = fs.readdirSync(crashesDir);
        const dumpFile = files.find((f) => f.startsWith('crash-') && f.endsWith('.json'));
        expect(dumpFile).toBeDefined();
        const dump = JSON.parse(fs.readFileSync(path.join(crashesDir, dumpFile!), 'utf-8')) as {
            readonly recentLogs: readonly LogEntry[];
        };

        expect(dump.recentLogs.length).toBe(MAX_CRASH_LOG_ENTRIES);
        expect(dump.recentLogs[0]?.message).toBe('msg-1');
        expect(dump.recentLogs[MAX_CRASH_LOG_ENTRIES - 1]?.message).toBe(`msg-${totalEntries - 1}`);
    });
});

describe('makeRendererGoneHandler', () => {
    it('logs renderer process-gone details at fatal level', () => {
        const logger = makeLogger();
        const handler = makeRendererGoneHandler({
            logger,
            crashesDir: path.join(tmpDir, 'crashes'),
            getSnapshot: () => null,
            reloadRenderer: vi.fn(),
        });

        handler({}, { reason: 'crashed', exitCode: 9 });

        expect(logger.fatal).toHaveBeenCalledWith(
            expect.stringContaining('render-process-gone'),
            expect.any(Error),
            expect.objectContaining({ reason: 'crashed', exitCode: 9 }),
        );
    });

    it('writes the renderer crash dump atomically', () => {
        const logger = makeLogger();
        const crashesDir = path.join(tmpDir, 'crashes');
        const recentLogs = [makeLogEntry('renderer-before-crash', 1)];
        const handler = makeRendererGoneHandler({
            logger,
            crashesDir,
            getSnapshot: () => ({ tick: 17 }),
            getRecentLogs: () => recentLogs,
            getAppVersion: () => '0.7.0-test',
            reloadRenderer: vi.fn(),
        });

        handler({}, { reason: 'oom', exitCode: 137 });

        const files = fs.readdirSync(crashesDir);
        const jsonFiles = files.filter((f) => f.endsWith('.json'));
        const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
        expect(jsonFiles).toHaveLength(1);
        expect(tmpFiles).toHaveLength(0);

        const dumpPath = path.join(crashesDir, jsonFiles[0]!);
        const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf-8')) as {
            readonly appVersion: string;
            readonly error: { readonly message: string };
            readonly osRelease?: unknown;
            readonly recentLogs: readonly LogEntry[];
            readonly snapshot: { readonly tick: number };
            readonly timestamp?: unknown;
            readonly versions?: { readonly node?: unknown };
        };
        expect(dump.appVersion).toBe('0.7.0-test');
        expect(dump.error.message).toContain('oom');
        expect(typeof dump.osRelease).toBe('string');
        expect(dump.recentLogs).toEqual(recentLogs);
        expect(dump.snapshot).toEqual({ tick: 17 });
        expect(typeof dump.timestamp).toBe('string');
        expect(dump.versions?.node).toEqual(expect.any(String));
    });

    it('reloads the window at most once for repeated renderer process-gone events', () => {
        const logger = makeLogger();
        const reloadRenderer = vi.fn();
        const handler = makeRendererGoneHandler({
            logger,
            crashesDir: path.join(tmpDir, 'crashes'),
            getSnapshot: () => null,
            reloadRenderer,
        });

        handler({}, { reason: 'crashed', exitCode: 9 });
        handler({}, { reason: 'crashed', exitCode: 9 });

        expect(reloadRenderer).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('renderer restart skipped'),
            expect.objectContaining({ reason: 'crashed', exitCode: 9 }),
        );
    });

    it('calls the repeated-crash shutdown callback on the second renderer process-gone event', () => {
        const logger = makeLogger();
        const reloadRenderer = vi.fn();
        const shutdownAfterRepeatedCrash = vi.fn();
        const handler = makeRendererGoneHandler({
            logger,
            crashesDir: path.join(tmpDir, 'crashes'),
            getSnapshot: () => null,
            reloadRenderer,
            shutdownAfterRepeatedCrash,
        });

        handler({}, { reason: 'crashed', exitCode: 9 });
        expect(shutdownAfterRepeatedCrash).not.toHaveBeenCalled();

        handler({}, { reason: 'crashed', exitCode: 9 });

        expect(reloadRenderer).toHaveBeenCalledOnce();
        expect(shutdownAfterRepeatedCrash).toHaveBeenCalledOnce();
    });
});
