// renderer/logging/rendererLogger.ts
//
// Renderer-side structured logger (§4.27). Hooks console.warn, console.error,
// window.addEventListener('error'), and window.addEventListener('unhandledrejection'),
// forwarding entries to the main process via the window.__chimera.logs IPC channel.
//
// Must NOT import from electron/, simulation/, or games/*.
// Uses globalThis.__chimera?.logs for root-tsconfig compatibility (no DOM).
// The renderer tsconfig has DOM, so `window` is valid in renderer source.

import type { LogEntry } from '@chimera-engine/simulation/foundation/logging.js';
import type { LogsAPI } from '@chimera-engine/simulation/bridge/api-types.js';

// Ambient declarations so the root tsconfig (no DOM lib) can type-check this
// file. The renderer tsconfig (lib: ["ES2022","DOM"]) provides the full types.
declare const window: {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
};

interface ErrorEvent extends Event {
    readonly message: string;
    readonly error?: unknown;
}

interface PromiseRejectionEvent extends Event {
    readonly reason: unknown;
}

export interface RendererLogEmitter {
    emit(entry: LogEntry): void;
}

// ── helpers ────────────────────────────────────────────────────────────────────

// Field caps mirrored from the main-process `chimera:logs:emit` schema
// (electron/main/ipc/ipc-schemas.ts, LogErrorInfoSchema / RendererLogEntrySchema).
// The handler DROPS an entry that fails validation rather than truncating it,
// so the renderer truncates first: an oversized stack must cost characters,
// never the whole entry. The two sides cannot share a constant — renderer code
// must not import from electron/** — so each cites the other.
//
// MAX_ERROR_STACK_LENGTH additionally bounds the `context.stack` the window
// handlers write (§4.27). The schema bounds `context`'s shape but not its
// extent, so an oversized value there cannot cost an entry — this bound is
// this module's own, so that every string the bridge itself composes is
// bounded rather than only the ones a validator would reject.
//
// A caller's `context` is the one thing no cap covers: it carries arbitrary
// structured diagnostics and passes through as given. That is not free of
// consequence — the schema still requires a record, so a caller handing
// emitRendererError a non-record `context` costs the whole entry.
const MAX_MESSAGE_LENGTH = 4096;
const MAX_MODULE_LENGTH = 256;
const MAX_ERROR_NAME_LENGTH = 256;
const MAX_ERROR_MESSAGE_LENGTH = 4096;
const MAX_ERROR_STACK_LENGTH = 8192;

function now(): number {
    return Date.now();
}

function makeEntry(
    level: LogEntry['level'],
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
    moduleName = 'global',
): LogEntry {
    return {
        level,
        message: message.slice(0, MAX_MESSAGE_LENGTH),
        timestamp: now(),
        source: { process: 'renderer', module: moduleName.slice(0, MAX_MODULE_LENGTH) },
        ...(context !== undefined && { context }),
        ...(error !== undefined && { error: serialiseError(error) }),
    };
}

function serialiseError(error: Error): NonNullable<LogEntry['error']> {
    return {
        name: error.name.slice(0, MAX_ERROR_NAME_LENGTH),
        message: error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
        ...(error.stack !== undefined && { stack: error.stack.slice(0, MAX_ERROR_STACK_LENGTH) }),
    };
}

function argsToMessage(args: readonly unknown[]): string {
    return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
}

/**
 * Split the first `Error` out of a patched console call's arguments.
 *
 * The stack is the one thing that makes a renderer error actionable, and
 * `String(err)` drops it — so the first `Error` is threaded into `makeEntry`'s
 * `error` parameter (`LogEntry.error` carries `name`/`message`/`stack`) and
 * removed from the composed message: its detail travels once, in the `error`
 * field, so the main-process logger does not print it twice. The remaining
 * arguments compose the message unchanged.
 */
function splitFirstError(args: readonly unknown[]): { error?: Error; rest: readonly unknown[] } {
    const index = args.findIndex((a) => a instanceof Error);
    if (index === -1) return { rest: args };
    return { error: args[index] as Error, rest: args.filter((_, i) => i !== index) };
}

/** The message for a console call, with a readable fallback for a lone Error. */
function composeMessage(rest: readonly unknown[], error: Error | undefined): string {
    if (rest.length > 0 || error === undefined) return argsToMessage(rest);
    return `${error.name}: ${error.message}`;
}

// ── idempotency guard ──────────────────────────────────────────────────────────

let installed = false;

// ── public API ─────────────────────────────────────────────────────────────────

/**
 * Patch the global error surfaces so renderer-side errors are forwarded to
 * the main process as structured log entries.
 *
 * Uses addEventListener so pre-existing handlers installed by Next.js,
 * React DevTools, or other libraries are composed rather than clobbered.
 * All logsApi.emit calls are wrapped in try/catch to prevent re-entry if
 * the IPC bridge itself throws.
 *
 * Idempotent: a second call while installed returns `null` — NOT a teardown —
 * so a caller can never claim ownership of a patch it did not create. A no-op
 * teardown would read as ownership, and a stale claim to it survives Fast
 * Refresh (this module's `installed` latch persists while a caller module
 * re-evaluates) and blocks every future re-install while reporting success.
 * The real teardown restores original console methods, removes event
 * listeners, and resets the installed guard.
 *
 * @param logsApi — the `window.__chimera.logs` namespace (or any compatible
 *   stub for tests).
 * @returns A teardown function that undoes all patches, or `null` if the
 *   bridge was already installed and this call changed nothing.
 */
export function installRendererLogger(logsApi: LogsAPI): (() => void) | null {
    if (installed) return null;
    installed = true;

    const origWarn = console.warn;
    const origError = console.error;

    console.warn = (...args: unknown[]): void => {
        origWarn(...args);
        try {
            const { error, rest } = splitFirstError(args);
            logsApi.emit(makeEntry('warn', composeMessage(rest, error), undefined, error));
        } catch {
            // swallow — prevent re-entry if IPC bridge throws
        }
    };

    console.error = (...args: unknown[]): void => {
        origError(...args);
        try {
            const { error, rest } = splitFirstError(args);
            logsApi.emit(makeEntry('error', composeMessage(rest, error), undefined, error));
        } catch {
            // swallow — prevent re-entry if IPC bridge throws
        }
    };

    const onError = (event: Event): void => {
        const e = event as ErrorEvent;
        const error = e.error instanceof Error ? e.error : undefined;
        const message = error?.message ?? e.message ?? 'Uncaught error';
        const context: Record<string, unknown> = {};
        if (error?.stack !== undefined) {
            context['stack'] = error.stack.slice(0, MAX_ERROR_STACK_LENGTH);
        }
        try {
            logsApi.emit(
                makeEntry('fatal', message, Object.keys(context).length > 0 ? context : undefined),
            );
        } catch {
            // swallow
        }
    };

    const onUnhandledRejection = (event: Event): void => {
        const e = event as PromiseRejectionEvent;
        const reason: unknown = e.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        const context: Record<string, unknown> = {};
        if (reason instanceof Error && reason.stack !== undefined) {
            context['stack'] = reason.stack.slice(0, MAX_ERROR_STACK_LENGTH);
        }
        try {
            logsApi.emit(
                makeEntry(
                    'error',
                    `Unhandled rejection: ${message}`,
                    Object.keys(context).length > 0 ? context : undefined,
                ),
            );
        } catch {
            // swallow
        }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return (): void => {
        console.warn = origWarn;
        console.error = origError;
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onUnhandledRejection);
        installed = false;
    };
}

export function emitRendererError(
    logsApi: RendererLogEmitter | undefined,
    message: string,
    error: Error,
    context?: Record<string, unknown>,
    moduleName = 'global',
): void {
    try {
        logsApi?.emit(makeEntry('error', message, context, error, moduleName));
    } catch {
        // swallow — prevent re-entry if IPC bridge throws
    }
}
