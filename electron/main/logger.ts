// electron/main/logger.ts
//
// Structured logger for the main process (architecture §4.27, invariant 67).
//
// This module declares the narrow `Logger` interface every main-process
// manager is constructed with, a matching `LoggerSink` output port, and
// three factories:
//
//   - `createLogger({ source, sink })` — root logger.
//   - `createNoopLogger()`               — discards every entry; used by
//                                          tests and by handler-registration
//                                          helpers that do not (yet) have a
//                                          real logger injected.
//   - `createMemorySink()`               — captures entries for assertion.
//   - `createPinoSink(logsDir, now?)`    — Pino-backed file sink with daily
//                                          rotation and 14-day retention.
//
// Invariant 67: no module emits logs via raw `console.*`; all structured
// logging flows through the injected `Logger`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import pino from 'pino';

import type {
    LogEntry,
    LogErrorInfo,
    LogLevel,
    LogSource,
    Logger,
} from '@chimera/shared/logging.js';

// `Logger` is declared in `shared/logging.ts` so that `simulation/` and `ai/`
// can accept an injected Logger without importing from `electron/`. Re-exported
// here so existing callers of `electron/main/logger.ts` see no breakage.
export type { Logger };

/**
 * Output port for a `Logger`. The root logger owns level routing and
 * context merging; the sink owns transport (write to file, write to
 * `process.stderr`, buffer in memory, …). Declared as a one-method port
 * so tests and production back-ends never need to implement unrelated
 * Pino surface.
 */
export interface LoggerSink {
    write(entry: LogEntry): void;
}

export interface CreateLoggerOptions {
    /** Root `LogSource` — `module` is overridable via `child({ module })`. */
    readonly source: LogSource;
    /** Transport. Call sites may pass `createMemorySink()` in tests. */
    readonly sink: LoggerSink;
    /**
     * Clock injection. Defaults to `Date.now`. Declared so deterministic
     * tests can freeze `timestamp` without mocking the global clock.
     */
    readonly now?: () => number;
}

/**
 * Build a root `Logger` bound to the given `source` and writing to the
 * given `sink`. Every log call composes a single {@link LogEntry} and
 * hands it to `sink.write` — the sink is the sole place where transport
 * concerns live.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
    const { source, sink } = options;
    const now = options.now ?? (() => Date.now());
    return buildLogger({ source, sink, now, boundContext: undefined });
}

interface InternalLoggerState {
    readonly source: LogSource;
    readonly sink: LoggerSink;
    readonly now: () => number;
    readonly boundContext: Readonly<Record<string, unknown>> | undefined;
}

function buildLogger(state: InternalLoggerState): Logger {
    const emit = (
        level: LogLevel,
        message: string,
        err: Error | undefined,
        ctx: Record<string, unknown> | undefined,
    ): void => {
        const context = mergeContext(state.boundContext, ctx);
        // Allow child({ module: '…' }) to override the root source module
        // so `logger.child({ module: 'game' }).info(…)` produces entries
        // tagged with that module without touching the sink.
        const resolvedSource: LogSource = resolveSource(state.source, context);
        const base = {
            level,
            message,
            timestamp: state.now(),
            source: resolvedSource,
        } satisfies Pick<LogEntry, 'level' | 'message' | 'timestamp' | 'source'>;
        const withContext = context !== undefined ? { ...base, context } : base;
        const entry: LogEntry =
            err !== undefined ? { ...withContext, error: serialiseError(err) } : withContext;
        state.sink.write(entry);
    };

    return {
        trace: (msg, ctx) => {
            emit('trace', msg, undefined, ctx);
        },
        debug: (msg, ctx) => {
            emit('debug', msg, undefined, ctx);
        },
        info: (msg, ctx) => {
            emit('info', msg, undefined, ctx);
        },
        warn: (msg, ctx) => {
            emit('warn', msg, undefined, ctx);
        },
        error: (msg, err, ctx) => {
            emit('error', msg, err, ctx);
        },
        fatal: (msg, err, ctx) => {
            emit('fatal', msg, err, ctx);
        },
        child: (ctx) =>
            buildLogger({
                source: state.source,
                sink: state.sink,
                now: state.now,
                boundContext: mergeContext(state.boundContext, ctx),
            }),
    };
}

function mergeContext(
    parent: Readonly<Record<string, unknown>> | undefined,
    child: Record<string, unknown> | undefined,
): Readonly<Record<string, unknown>> | undefined {
    if (parent === undefined) {
        return child === undefined ? undefined : { ...child };
    }
    if (child === undefined) {
        return parent;
    }
    return { ...parent, ...child };
}

/**
 * If the merged context carries a `module` string, adopt it as the emitted
 * {@link LogSource.module}. Keeps the `{ module: 'saves' }` idiom from
 * architecture §4.27 working without a parallel "source" argument on
 * `.child()`.
 */
function resolveSource(
    rootSource: LogSource,
    context: Readonly<Record<string, unknown>> | undefined,
): LogSource {
    if (context === undefined) {
        return rootSource;
    }
    const moduleOverride = context['module'];
    if (typeof moduleOverride !== 'string' || moduleOverride.length === 0) {
        return rootSource;
    }
    return { process: rootSource.process, module: moduleOverride };
}

function serialiseError(err: Error): LogErrorInfo {
    const info: { name: string; message: string; stack?: string } = {
        name: err.name,
        message: err.message,
    };
    if (typeof err.stack === 'string') {
        info.stack = err.stack;
    }
    return info;
}

/**
 * Memory-backed {@link LoggerSink}. Used in tests to assert what the
 * system-under-test logged, and by `createNoopLogger` as the trivial
 * write target (entries are discarded — see below).
 */
export interface MemorySink extends LoggerSink {
    readonly entries: readonly LogEntry[];
    /** Maximum number of entries the ring buffer retains. */
    readonly capacity: number;
    clear(): void;
}

/**
 * Default capacity for the in-memory log ring buffer (number of entries).
 * Large enough to retain a full session's recent logs, small enough to bound
 * memory use regardless of renderer-driven log volume.
 */
const MEMORY_SINK_DEFAULT_CAPACITY = 2000;

export function createMemorySink(capacity = MEMORY_SINK_DEFAULT_CAPACITY): MemorySink {
    const buffer: (LogEntry | undefined)[] = new Array<LogEntry | undefined>(capacity);
    let head = 0; // index of the oldest entry in the ring
    let size = 0; // number of valid entries currently held
    return {
        write(entry) {
            const slot = (head + size) % capacity;
            buffer[slot] = entry;
            if (size < capacity) {
                size++;
            } else {
                // Buffer full — evict oldest by advancing head
                head = (head + 1) % capacity;
            }
        },
        get entries(): readonly LogEntry[] {
            const result: LogEntry[] = [];
            for (let i = 0; i < size; i++) {
                result.push(buffer[(head + i) % capacity]!);
            }
            return result;
        },
        get capacity() {
            return capacity;
        },
        clear() {
            head = 0;
            size = 0;
        },
    };
}

/**
 * Sink that discards every entry. Used as the default backing for
 * `createNoopLogger` so call sites that do not care about logs (tests,
 * handler-registration helpers that have not yet received an injected
 * logger) can still invoke the full `Logger` surface without side effects.
 */
const NOOP_SINK: LoggerSink = {
    write: () => {
        // Intentional no-op.
    },
};

const NOOP_SOURCE: LogSource = { process: 'main', module: 'noop' };

/**
 * Trivial {@link Logger} that discards every entry. Handy default for
 * tests and for the F02 handler-registration helpers (which take an
 * optional `logger` — managers landing in F03+ will demand a real one).
 */
export function createNoopLogger(): Logger {
    return createLogger({ source: NOOP_SOURCE, sink: NOOP_SINK });
}

// ─── Pino-backed file sink ────────────────────────────────────────────────────

const LOG_RETENTION_DAYS = 14;
const LOG_FILENAME_PATTERN = /^chimera-(\d{4}-\d{2}-\d{2})\.log$/;

function toDateString(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function pruneOldLogs(logsDir: string, now: Date): void {
    const cutoffMs = now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let files: string[];
    try {
        files = fs.readdirSync(logsDir);
    } catch {
        return; // Directory does not exist yet — nothing to prune.
    }
    for (const file of files) {
        const match = LOG_FILENAME_PATTERN.exec(file);
        if (match === null) continue;
        const fileDate = new Date(match[1]!);
        if (fileDate.getTime() < cutoffMs) {
            try {
                fs.unlinkSync(path.join(logsDir, file));
            } catch {
                // Best-effort: ignore if the file was already removed concurrently.
            }
        }
    }
}

/**
 * Pino-backed {@link LoggerSink} that writes JSON-line entries to a daily
 * rotating log file under `logsDir`:
 *
 *   `<logsDir>/chimera-YYYY-MM-DD.log`
 *
 * Files older than 14 days are pruned synchronously on construction.
 * The optional `now` parameter injects a clock for deterministic tests.
 *
 * Backed by {@link https://getpino.io pino}'s `destination()` (SonicBoom)
 * for efficient file writes. See §4.27.
 */
export function createPinoSink(logsDir: string, now?: () => Date): LoggerSink {
    fs.mkdirSync(logsDir, { recursive: true });
    pruneOldLogs(logsDir, now?.() ?? new Date());

    let currentDateStr = '';
    let dest: ReturnType<typeof pino.destination> | null = null;

    return {
        write(entry: LogEntry): void {
            const today = toDateString(now?.() ?? new Date());
            if (today !== currentDateStr || dest === null) {
                currentDateStr = today;
                const filepath = path.join(logsDir, `chimera-${today}.log`);
                dest = pino.destination({ dest: filepath, append: true, sync: true });
            }
            dest.write(JSON.stringify(entry) + '\n');
        },
    };
}
