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
//
// Production `LoggerSink` implementations (Pino-backed file rotation,
// console JSON-line mirror) land in F43 (§4.27). F02 only needs the
// interface + injection plumbing in place so managers landing in F03+
// find the socket pre-wired and today's IPC handlers can emit structured
// events through it.
//
// Invariant 67: no module emits logs via raw `console.*`; all structured
// logging flows through the injected `Logger`.

import type { LogEntry, LogErrorInfo, LogLevel, LogSource } from '../../shared/logging.js';

/**
 * The narrow surface every main-process manager depends on. Matches
 * architecture §4.27 character-for-character.
 *
 * `error` and `fatal` accept an optional `Error` because these levels are
 * almost always paired with an exception; `trace` / `debug` / `info` /
 * `warn` take only a message and a context object because attaching a raw
 * `Error` to an info-level entry is usually a sign that the level is
 * wrong.
 */
export interface Logger {
    trace(msg: string, ctx?: Record<string, unknown>): void;
    debug(msg: string, ctx?: Record<string, unknown>): void;
    info(msg: string, ctx?: Record<string, unknown>): void;
    warn(msg: string, ctx?: Record<string, unknown>): void;
    error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
    fatal(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
    /**
     * Return a child logger whose bound context is merged into every entry.
     * Repeated `.child()` calls deep-merge (shallow spread) into the parent
     * context so `logger.child({ module: 'saves' }).child({ slotId })`
     * produces entries with both keys bound.
     */
    child(ctx: Record<string, unknown>): Logger;
}

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
    clear(): void;
}

export function createMemorySink(): MemorySink {
    const entries: LogEntry[] = [];
    return {
        write(entry) {
            entries.push(entry);
        },
        get entries() {
            return entries;
        },
        clear() {
            entries.length = 0;
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
