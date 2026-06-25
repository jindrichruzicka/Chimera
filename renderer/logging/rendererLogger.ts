// renderer/logging/rendererLogger.ts
//
// Renderer-side structured logger (§4.27). Hooks console.warn, console.error,
// window.addEventListener('error'), and window.addEventListener('unhandledrejection'),
// forwarding entries to the main process via the window.__chimera.logs IPC channel.
//
// Must NOT import from electron/, simulation/, or games/*.
// Uses globalThis.__chimera?.logs for root-tsconfig compatibility (no DOM).
// The renderer tsconfig has DOM, so `window` is valid in renderer source.

import type { LogEntry } from '@chimera/simulation/foundation/logging.js';
import type { LogsAPI } from '@chimera/simulation/bridge/api-types.js';

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
        message,
        timestamp: now(),
        source: { process: 'renderer', module: moduleName },
        ...(context !== undefined && { context }),
        ...(error !== undefined && { error: serialiseError(error) }),
    };
}

function serialiseError(error: Error): NonNullable<LogEntry['error']> {
    return {
        name: error.name,
        message: error.message,
        ...(error.stack !== undefined && { stack: error.stack }),
    };
}

function argsToMessage(args: unknown[]): string {
    return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
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
 * Idempotent: calling more than once is a no-op until the returned teardown
 * is called. The teardown restores original console methods, removes event
 * listeners, and resets the installed guard.
 *
 * @param logsApi — the `window.__chimera.logs` namespace (or any compatible
 *   stub for tests).
 * @returns A teardown function that undoes all patches.
 */
export function installRendererLogger(logsApi: LogsAPI): () => void {
    if (installed)
        return (): void => {
            /* already installed — no-op teardown */
        };
    installed = true;

    const origWarn = console.warn;
    const origError = console.error;

    // console.warn → level: 'warn'
    console.warn = (...args: unknown[]): void => {
        origWarn(...args);
        try {
            logsApi.emit(makeEntry('warn', argsToMessage(args)));
        } catch {
            // swallow — prevent re-entry if IPC bridge throws
        }
    };

    // console.error → level: 'error'
    console.error = (...args: unknown[]): void => {
        origError(...args);
        try {
            logsApi.emit(makeEntry('error', argsToMessage(args)));
        } catch {
            // swallow — prevent re-entry if IPC bridge throws
        }
    };

    // window 'error' event → level: 'fatal'
    const onError = (event: Event): void => {
        const e = event as ErrorEvent;
        const error = e.error instanceof Error ? e.error : undefined;
        const message = error?.message ?? e.message ?? 'Uncaught error';
        const context: Record<string, unknown> = {};
        if (error?.stack !== undefined) {
            context['stack'] = error.stack;
        }
        try {
            logsApi.emit(
                makeEntry('fatal', message, Object.keys(context).length > 0 ? context : undefined),
            );
        } catch {
            // swallow
        }
    };

    // window 'unhandledrejection' event → level: 'error'
    const onUnhandledRejection = (event: Event): void => {
        const e = event as PromiseRejectionEvent;
        const reason: unknown = e.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        const context: Record<string, unknown> = {};
        if (reason instanceof Error && reason.stack !== undefined) {
            context['stack'] = reason.stack;
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
