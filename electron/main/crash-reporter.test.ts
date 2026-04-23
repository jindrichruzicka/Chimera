import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from './logger.js';
import { type CrashReporterOptions, registerCrashReporter } from './crash-reporter.js';

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

// ── tests ─────────────────────────────────────────────────────────────────────

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
});
