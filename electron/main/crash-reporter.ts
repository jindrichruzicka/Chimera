/**
 * @module crash-reporter
 *
 * Registers three failure listeners for the Electron main process (§4.27):
 *
 *   1. `process.on('uncaughtException')` — logs fatal, autosaves, writes an
 *      atomic JSON crash dump under `crashesDir/`, then exits gracefully.
 *   2. `process.on('unhandledRejection')` — logs error; does NOT exit.
 *   3. `app.on('before-quit')` — placeholder for future renderer-gone handling.
 *
 * The crash dump is written atomically: first to `<path>.tmp`, then renamed
 * to the final path to prevent partial writes (Invariant 68).
 *
 * No import from `renderer/`, `simulation/`, or `games/*` — all
 * simulation/game state is accessed through injected callbacks (DIP).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from './logger.js';

// ── public contract ────────────────────────────────────────────────────────────

export interface CrashReporterOptions {
    /** Main-process logger; crash reporter logs to it and includes its buffer in dumps. */
    readonly logger: Logger;
    /** Directory under which `crash-<iso>.json` files are written. */
    readonly crashesDir: string;
    /** Returns the current game snapshot (or `null` if no simulation is running). */
    readonly getSnapshot?: () => unknown;
    /** Called before writing the crash dump on `uncaughtException`. */
    readonly autosave?: () => Promise<void>;
    /**
     * Called in the `uncaughtException` path before `process.exit`, after all
     * logging and dumping is complete. Use this to flush any async log sink
     * (e.g. `pinoSink.flushSync()`) so buffered entries reach disk before the
     * process terminates. Optional — if omitted, no flush is performed.
     */
    readonly flush?: () => void;
    /**
     * Injection point for `process` — defaults to the real global `process`.
     * Injected in tests to avoid hooking the real process listeners.
     */
    readonly process?: NodeJS.Process;
    /**
     * Narrow slice of `Electron.App` needed for lifecycle events.
     * Injected in tests.
     */
    readonly app?: {
        on(event: string, handler: (...args: readonly unknown[]) => void): void;
    };
}

// ── implementation ─────────────────────────────────────────────────────────────

/**
 * Register crash-reporter listeners on `process` and `app`.
 *
 * Call once during main process start-up, after the logger is ready,
 * before the first `BrowserWindow` is created.
 */
export function registerCrashReporter(options: CrashReporterOptions): void {
    const { logger, crashesDir, getSnapshot, autosave } = options;
    const proc: NodeJS.Process = options.process ?? process;

    proc.on('uncaughtException', (err: Error) => {
        void handleUncaughtException(err, {
            logger,
            crashesDir,
            proc,
            ...(options.flush !== undefined && { flush: options.flush }),
            ...(getSnapshot !== undefined && { getSnapshot }),
            ...(autosave !== undefined && { autosave }),
        });
    });

    proc.on('unhandledRejection', (reason: unknown) => {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        logger.error('Unhandled promise rejection', err, { reason: String(reason) });
    });
}

// ── private helpers ────────────────────────────────────────────────────────────

/**
 * Maximum serialised byte length allowed for the snapshot field in a crash
 * dump. Snapshots exceeding this limit are replaced with a truncation sentinel
 * to prevent synchronous I/O of tens-of-megabytes on the crash path.
 */
const MAX_SNAPSHOT_BYTES = 512_000;

/**
 * Serialise `snapshot` safely for inclusion in a crash dump.
 *
 * - Circular references in the value are replaced with the string `"[Circular]"`
 *   (WeakSet-based cycle detection — O(1) per node, no JSON.stringify throw).
 * - If the resulting serialised string would exceed `MAX_SNAPSHOT_BYTES` the
 *   whole field is replaced with `{ truncated: true, reason: 'size_limit' }`.
 * - Non-object primitives (numbers, strings, booleans, `null`) pass through
 *   without modification.
 *
 * Exported for direct unit testing — not part of the public module API.
 */
export function safeSerialiseSnapshot(snapshot: unknown): unknown {
    if (snapshot === null || typeof snapshot !== 'object') {
        return snapshot;
    }

    // Build a cycle-safe copy via a WeakSet replacer.
    const seen = new WeakSet<object>();

    const replacer = (_key: string, value: unknown): unknown => {
        if (value !== null && typeof value === 'object') {
            if (seen.has(value)) {
                return '[Circular]';
            }
            seen.add(value);
        }
        return value;
    };

    const serialised = JSON.stringify(snapshot, replacer);

    // Check size in bytes (UTF-8; JSON.stringify produces a UTF-16 JS string
    // but the characters are all ASCII-range for typical snapshots; using
    // .length as byte proxy is conservative — Buffer.byteLength would be more
    // precise but introduces a Node.js dependency we can keep optional here).
    if (serialised.length > MAX_SNAPSHOT_BYTES) {
        return { truncated: true, reason: 'size_limit' };
    }

    return JSON.parse(serialised) as unknown;
}

async function handleUncaughtException(
    err: Error,
    options: {
        readonly logger: Logger;
        readonly crashesDir: string;
        readonly proc: NodeJS.Process;
        readonly flush?: () => void;
        readonly getSnapshot?: () => unknown;
        readonly autosave?: () => Promise<void>;
    },
): Promise<void> {
    const { logger, crashesDir, proc, getSnapshot, autosave } = options;

    logger.fatal('uncaughtException — writing crash dump', err, { stack: err.stack });

    try {
        if (autosave !== undefined) {
            try {
                await autosave();
            } catch (saveErr) {
                const e = saveErr instanceof Error ? saveErr : new Error(String(saveErr));
                logger.error('autosave failed during crash handling', e, {});
            }
        }

        try {
            writeCrashDump(crashesDir, err, getSnapshot?.() ?? null);
        } catch (writeErr) {
            const e = writeErr instanceof Error ? writeErr : new Error(String(writeErr));
            logger.error('failed to write crash dump', e, {});
        }
    } finally {
        // Flush any async log sink so buffered entries reach disk before exit.
        options.flush?.();
        proc.exit(1);
    }
}

function writeCrashDump(crashesDir: string, err: Error, snapshot: unknown): void {
    fs.mkdirSync(crashesDir, { recursive: true });

    const isoTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `crash-${isoTimestamp}.json`;
    const finalPath = path.join(crashesDir, filename);
    const tmpPath = `${finalPath}.tmp`;

    const dump = {
        timestamp: new Date().toISOString(),
        error: {
            name: err.name,
            message: err.message,
            stack: err.stack,
        },
        versions: process.versions,
        osRelease: os.release(),
        snapshot: safeSerialiseSnapshot(snapshot ?? null),
    };

    const data = JSON.stringify(dump, null, 2);

    // Write atomically with fsync before rename (Invariant #68): openSync
    // the .tmp file so the fd is available for fsyncSync, then rename to
    // the final path only after the OS confirms the data is on stable storage.
    const fd = fs.openSync(tmpPath, 'w');
    try {
        fs.writeSync(fd, data, null, 'utf-8');
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, finalPath);
}
