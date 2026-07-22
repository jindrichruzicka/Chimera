// electron/main/logging/logger.ts
//
// Structured logger for the main process (architecture §4.27, invariant 67).
//
// This module declares the narrow `Logger` interface every main-process
// manager is constructed with, a matching `LoggerSink` output port, and the
// factories for both:
//
//   Loggers
//   - `createLogger({ source, sink })`    — root logger.
//   - `createNoopLogger()`                — discards every entry; used by
//                                           tests and by handler-registration
//                                           helpers that do not (yet) have a
//                                           real logger injected.
//   Sinks
//   - `createMemorySink()`                — captures entries for assertion and
//                                           backs the logs IPC `readRecent`.
//   - `createPinoSink(logsDir, now?)`     — Pino-backed file sink with daily
//                                           rotation and 14-day retention.
//   - `createStdoutSink(write?)`          — one human-readable line per entry
//                                           to stdout (dev harness, §4.32).
//   - `createStderrSink(write?)`          — the same to stderr (dev terminal
//                                           mirror for a plain dev launch).
//   Composition
//   - `createFanOutSink(sinks)`           — one entry to many sinks, each leg
//                                           isolated from the others.
//   - `createMinLevelSink(min, sink)`     — level threshold in front of a sink.
//   - `startPeriodicFlush(sink, ms)`      — interval drain for a buffered sink.
//
// Invariant 67: no module emits logs via raw `console.*`; all structured
// logging flows through the injected `Logger`. The stdout/stderr sinks are
// transport for that logger, not an exception to it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import pino from 'pino';

import type {
    LogEntry,
    LogErrorInfo,
    LogLevel,
    LogSource,
    Logger,
} from '@chimera-engine/simulation/foundation/logging.js';

// `Logger` is declared in `simulation/foundation/logging.ts` so that
// `simulation/` and `ai/` can accept an injected Logger without importing from
// `electron/`. Re-exported here so main-process callers have one import site.
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

/**
 * A {@link LoggerSink} that supports explicit flushing. Returned by
 * `createPinoSink` so crash and shutdown paths can call `flushSync()`
 * before the process exits to ensure all buffered async writes reach disk.
 */
export interface FlushableSink extends LoggerSink {
    flushSync(): void;
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
 * tests and for handler-registration helpers that take an optional
 * `logger`; managers demand a real one.
 */
export function createNoopLogger(): Logger {
    return createLogger({ source: NOOP_SOURCE, sink: NOOP_SINK });
}

// ─── Console sinks (dev-harness streaming, dev terminal mirror) ───────────────

/** One human-readable line per entry. Shared by both console sinks. */
function formatConsoleLine(entry: LogEntry): string {
    // Pad to the longest level tag ('error') so columns align.
    const level = entry.level.padEnd(5, ' ');
    const context =
        entry.context !== undefined && Object.keys(entry.context).length > 0
            ? ` ${JSON.stringify(entry.context)}`
            : '';
    const error = entry.error !== undefined ? ` — ${entry.error.message}` : '';
    return `${level} [${entry.source.module}] ${entry.message}${context}${error}\n`;
}

/**
 * Shared body of {@link createStdoutSink} and {@link createStderrSink}.
 *
 * The guard covers **formatting as well as writing** — both steps are inside
 * the `try` — so a `write` that fails (`EPIPE` once the parent closed the pipe)
 * and an entry that cannot be rendered (a circular reference or a `BigInt` in
 * `context`, which `JSON.stringify` throws on) are both dropped from the echo
 * rather than raised at the caller.
 *
 * The rule it serves: a `Logger` call must never throw into its call site
 * because a convenience mirror could not write. This guard is defence in depth
 * for that rule, not the thing that enforces it — {@link createFanOutSink} is,
 * and every production wiring of these sinks goes through it. The guard is what
 * keeps them safe when they do not: a sink handed straight to `createLogger`
 * (as this module's own tests do) has nothing else between it and the caller.
 *
 * It also decides WHERE the line is lost, which is not a wash. A console mirror
 * that swallows loses one echo; the same failure surfacing at the fan-out costs
 * the leg its `announce` slot and puts a notice about a *convenience* stream in
 * the durable record. The file sink is the record and stays unguarded for the
 * opposite reason: its failures are worth announcing.
 */
function createConsoleSink(write: (line: string) => void): LoggerSink {
    return {
        write(entry: LogEntry): void {
            try {
                write(formatConsoleLine(entry));
            } catch {
                // Best-effort echo — see above.
            }
        },
    };
}

/**
 * A {@link LoggerSink} that renders each entry as one human-readable line to
 * stdout. Wired into the main fan-out ONLY when the dev multiplayer harness is
 * active (§4.32): the orchestrator pipes every child's stdout with a `[p<i>]`
 * prefix, so `pnpm dev:mp` streams each instance's main-process logs live in
 * one terminal — the file sink alone is not enough there, because its
 * crash-safe SonicBoom buffer (`minLength: 4096`, see {@link createPinoSink})
 * holds sparse post-startup entries off disk until a flush.
 *
 * This is a sink, not a `console.*` call site — modules keep logging through
 * their injected `Logger` (Invariant #67); the `write` parameter exists for
 * tests and defaults to `process.stdout`.
 */
export function createStdoutSink(
    write: (line: string) => void = (line): void => void process.stdout.write(line),
): LoggerSink {
    return createConsoleSink(write);
}

/**
 * A {@link LoggerSink} that renders each entry as one human-readable line to
 * **stderr**. Wired into the main fan-out for an unpackaged, non-harness launch
 * (`pnpm start`), where it is the only thing that puts a log line in the
 * terminal the developer launched from: the production Pino sink writes to the
 * log file and nowhere else, and `createStdoutSink` is harness-only (stdout
 * there belongs to the orchestrator, which prefixes and relays it).
 *
 * Wrap it in {@link createMinLevelSink} at the call site — this sink writes
 * whatever it is handed, and the root `Logger` applies no level threshold of
 * its own, so an unfiltered mirror would put every `trace` entry on the
 * terminal.
 *
 * Like {@link createStdoutSink} this is a sink, not a `console.*` call site
 * (Invariant #67); the `write` parameter exists for tests and defaults to
 * `process.stderr`.
 */
export function createStderrSink(
    write: (line: string) => void = (line): void => void process.stderr.write(line),
): LoggerSink {
    return createConsoleSink(write);
}

// ─── Fan-out ──────────────────────────────────────────────────────────────────

/**
 * Fan every entry out to several sinks, isolating each leg from the others and
 * from the caller. Legs are named so a failure notice can say which transport it
 * means; `null`/`undefined` ones are dropped, so a conditionally wired sink
 * needs no branch at the call site.
 *
 * Isolation is the point. The sinks are independent transports with independent
 * failure modes — a full disk, a rotated-away file descriptor, a closed pipe —
 * and one of them failing must not deny the others the entry. Without it the
 * declaration order silently decided what survived: the Pino sink is written
 * first and `createPinoSink.write` opens a file descriptor, so one `EBADF` there
 * took the in-memory ring buffer and whichever console mirror is wired down with
 * refusal would then exit 1 having written nothing to the log file AND nothing
 * to the terminal.
 *
 * A logging call must also never throw into unrelated business logic: an IPC
 * handler that emits a `debug` line must not fail because the log volume is
 * full. So the caller never sees a leg fail — but silence is not the same as
 * isolation. No sink here reports its own failures, and in production nothing
 * else calls them, so a swallowed throw would mean a transport could stop
 * working with no signal anywhere. Each failure is therefore announced on the
 * surviving legs — the only channels left — after they have taken the entry that
 * provoked it.
 *
 * Announced once per *run* of failures, not once per leg and not once per entry.
 * Both bounds matter, because one leg has two unrelated failure modes:
 * `createPinoSink.write` throws on a dead fd, which recurs on every entry and
 * would otherwise flood the survivors, and separately on an entry it cannot
 * serialise (a circular or `BigInt` `context`), which is transient and leaves
 * the sink healthy. Latching for the session would let one bad `context` spend
 * the leg's only announcement and then swallow the genuine `EBADF` that follows,
 * so the latch clears the moment that leg writes successfully again.
 */
export function createFanOutSink(
    sinks: Readonly<Record<string, LoggerSink | null | undefined>>,
): LoggerSink {
    const active = Object.entries(sinks).filter(
        (pair): pair is [string, LoggerSink] => pair[1] !== null && pair[1] !== undefined,
    );
    // Legs currently inside a run of failures. Bounded by the leg count.
    const failing = new Set<string>();
    return {
        write(entry: LogEntry): void {
            let failures: { name: string; err: unknown }[] | null = null;

            for (const [name, sink] of active) {
                try {
                    sink.write(entry);
                    // Recovered (or never broken) — the next failure is news again.
                    failing.delete(name);
                } catch (err: unknown) {
                    if (!failing.has(name)) {
                        failing.add(name);
                        (failures ??= []).push({ name, err });
                    }
                }
            }

            // After the delivery loop, so no leg's own entry is delayed behind
            // another leg's notice, and a notice never precedes what caused it.
            for (const failure of failures ?? []) {
                announce(active, failure.name, failure.err, entry.timestamp);
            }
        },
    };
}

/**
 * Tell the legs that still work that leg `name` does not. Best-effort by
 * construction: a notice that cannot be delivered is dropped, and a failure
 * raised while announcing never announces in turn — two broken transports must
 * not ping-pong.
 */
function announce(
    active: readonly (readonly [string, LoggerSink])[],
    name: string,
    err: unknown,
    timestamp: number,
): void {
    const error = err instanceof Error ? err : new Error(String(err));
    const notice: LogEntry = {
        level: 'error',
        message: `log sink "${name}" failed; this entry did not reach it, and further consecutive failures stay silent until it writes again`,
        timestamp,
        source: { process: 'main', module: 'logging' },
        error: serialiseError(error),
    };

    for (const [other, sink] of active) {
        if (other === name) {
            continue;
        }
        try {
            sink.write(notice);
        } catch {
            // Nowhere left to report this to — see above.
        }
    }
}

// ─── Level filtering ──────────────────────────────────────────────────────────

/** Ordinal severity of each {@link LogLevel}; the filter compares on this. */
const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
    fatal: 5,
};

/**
 * Wrap a {@link LoggerSink} so it only receives entries at or above `minLevel`.
 *
 * Level routing deliberately lives here rather than in the `Logger` or in a
 * sink: the root logger fans out to several sinks with different appetites (the
 * file sink keeps everything; the dev terminal mirror wants failures only), so
 * a single threshold on the logger would starve one of them.
 */
export function createMinLevelSink(minLevel: LogLevel, sink: LoggerSink): LoggerSink {
    const threshold = LOG_LEVEL_RANK[minLevel];
    return {
        write(entry: LogEntry): void {
            if (LOG_LEVEL_RANK[entry.level] >= threshold) {
                sink.write(entry);
            }
        },
    };
}

/**
 * Flush a {@link FlushableSink} on a fixed interval; returns a disposer. Used
 * by the dev-harness boot so the on-disk log stays near-real-time despite the
 * file sink's crash-safe buffering — without it, sparse post-startup entries
 * can sit invisible in the SonicBoom buffer for minutes (and are lost outright
 * on SIGKILL). A throwing flush (transient fs error) is swallowed so one bad
 * tick never kills the timer. The interval is `unref`'d where supported so it
 * never holds the process open.
 */
export function startPeriodicFlush(sink: Pick<FlushableSink, 'flushSync'>, ms: number): () => void {
    const timer = setInterval(() => {
        try {
            sink.flushSync();
        } catch {
            // Transient flush failures must not stop future ticks.
        }
    }, ms);
    timer.unref?.();
    return (): void => clearInterval(timer);
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
export function createPinoSink(logsDir: string, now?: () => Date): FlushableSink {
    fs.mkdirSync(logsDir, { recursive: true });
    pruneOldLogs(logsDir, now?.() ?? new Date());

    let currentDateStr = '';
    let dest: ReturnType<typeof pino.destination> | null = null;

    return {
        write(entry: LogEntry): void {
            const today = toDateString(now?.() ?? new Date());
            if (today !== currentDateStr || dest === null) {
                // Close the previous SonicBoom before rolling to a new file.
                // flushSync() drains buffered data to the fd; end() releases
                // the file descriptor so the OS can reclaim it (Invariant #68).
                if (dest !== null) {
                    dest.flushSync();
                    dest.end();
                }
                currentDateStr = today;
                const filepath = path.join(logsDir, `chimera-${today}.log`);
                // Open the file synchronously to obtain an immediately-available fd.
                // Passing a numeric fd to pino.destination sets SonicBoom.fd at
                // construction time (no async open), so flushSync() can be called
                // at any point (crash path, rollover, before-quit) without the
                // "sonic boom is not ready yet" error. Writes remain async —
                // SonicBoom buffers and drains independently of the write() caller,
                // keeping the main-process event loop unblocked (§4.27).
                const fd = fs.openSync(filepath, 'a');
                // minLength: 4096 keeps writes in SonicBoom's JS buffer until
                // flushSync() drains them synchronously. Without this, each
                // write() immediately starts an async fs.write (setting
                // _writing=true), which races against the fsyncSync call inside
                // flushSync() — the libuv write may not have reached the kernel
                // yet, so fsync flushes nothing. With a non-zero minLength,
                // _writing stays false for typical small entries and flushSync()
                // always drains the buffer atomically. (§4.27)
                dest = pino.destination({ dest: fd, minLength: 4096 });
            }
            dest.write(JSON.stringify(entry) + '\n');
        },

        flushSync(): void {
            dest?.flushSync();
        },
    };
}
