// shared/logging.ts
//
// Shared log schema for the main process, renderer, and simulation layer
// (architecture §4.27). Declared in `shared/` because both sides of the
// preload bridge need to agree on the shape — the renderer emits via
// `window.__chimera.logs` (F43) and the main process writes via the
// structured `Logger` interface declared in `electron/main/logger.ts`.
//
// Kept dependency-free and side-effect-free so `simulation/` and `ai/` can
// import these types without dragging Electron or DOM symbols along.

/** Severity ordered trace < debug < info < warn < error < fatal. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Structured logger interface consumed by every main-process manager and by the
 * simulation layer (which imports it via `shared/` to respect module boundaries).
 *
 * Intentionally kept in `shared/` so `simulation/` and `ai/` can accept an
 * injected `Logger` without importing from `electron/`.
 *
 * Production implementations live in `electron/main/logger.ts` (F02/F08).
 * `error` and `fatal` accept an optional `Error` because these levels are almost
 * always paired with an exception; trace/debug/info/warn take only a message and
 * a context object.
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
 * Origin of a log entry. The `process` tag identifies which half of the
 * application emitted the record; the `module` string is a short,
 * namespace-style name used to route and filter entries (e.g. `'game'`,
 * `'saves'`, `'simulation.action-pipeline'`).
 */
export type LogSource =
    | { readonly process: 'main'; readonly module: string }
    | { readonly process: 'renderer'; readonly module: string }
    | { readonly process: 'simulation'; readonly module: string };

/**
 * Serialised form of an `Error` attached to a log entry. Kept as plain
 * data so entries can be JSON-encoded for rotation files / IPC transport
 * without losing the stack trace.
 */
export interface LogErrorInfo {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
}

/**
 * A single structured log record. `timestamp` is wall-clock milliseconds
 * at the emit site (not a simulation tick — logs are observer-side).
 *
 * Invariant #69 binds the _storage_ of these entries (local-only, no
 * automatic telemetry). The shape itself carries no privacy commitment.
 */
export interface LogEntry {
    readonly level: LogLevel;
    readonly message: string;
    readonly timestamp: number;
    readonly source: LogSource;
    readonly context?: Readonly<Record<string, unknown>>;
    readonly error?: LogErrorInfo;
}
