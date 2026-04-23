// renderer/logging/rendererLogger.ts
//
// Renderer-side structured logger (§4.27). Hooks console.warn, console.error,
// window.onerror, and window.onunhandledrejection, forwarding entries to the
// main process via the window.__chimera.logs IPC channel.
//
// Must NOT import from electron/, simulation/, or games/*.
// Uses globalThis.__chimera?.logs for root-tsconfig compatibility (no DOM).
// The renderer tsconfig has DOM, so `window` is valid in renderer source.

import type { LogEntry } from '@chimera/shared/logging.js';
import type { LogsAPI } from '@chimera/electron/preload/api-types.js';

// Ambient declarations so the root tsconfig (no DOM lib) can type-check this
// file. The renderer tsconfig (lib: ["ES2022","DOM"]) provides the full types.
declare const window: {
    onerror:
        | ((
              event: string | Event,
              source?: string,
              lineno?: number,
              colno?: number,
              error?: Error,
          ) => boolean | void)
        | null;
    onunhandledrejection: ((event: PromiseRejectionEvent) => void) | null;
};

interface PromiseRejectionEvent {
    readonly reason: unknown;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function now(): number {
    return Date.now();
}

function makeEntry(
    level: LogEntry['level'],
    message: string,
    context?: Record<string, unknown>,
): LogEntry {
    return {
        level,
        message,
        timestamp: now(),
        source: { process: 'renderer', module: 'global' },
        ...(context !== undefined && { context }),
    };
}

function argsToMessage(args: unknown[]): string {
    return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
}

// ── public API ─────────────────────────────────────────────────────────────────

/**
 * Patch the global error surfaces so renderer-side errors are forwarded to
 * the main process as structured log entries.
 *
 * Call once during renderer boot (before React hydration). Calling twice
 * compounds the hooks — callers must guard against that in production.
 *
 * @param logsApi — the `window.__chimera.logs` namespace (or any compatible
 *   stub for tests).
 */
export function installRendererLogger(logsApi: LogsAPI): void {
    const origWarn = console.warn;
    const origError = console.error;

    // console.warn → level: 'warn'
    console.warn = (...args: unknown[]): void => {
        origWarn(...args);
        logsApi.emit(makeEntry('warn', argsToMessage(args)));
    };

    // console.error → level: 'error'
    console.error = (...args: unknown[]): void => {
        origError(...args);
        logsApi.emit(makeEntry('error', argsToMessage(args)));
    };

    // window.onerror → level: 'fatal'
    window.onerror = (
        event: string | Event,
        _source?: string,
        _lineno?: number,
        _colno?: number,
        error?: Error,
    ): boolean => {
        const message = error?.message ?? (typeof event === 'string' ? event : 'Uncaught error');
        const context: Record<string, unknown> = {};
        if (error?.stack !== undefined) {
            context['stack'] = error.stack;
        }
        logsApi.emit(
            makeEntry('fatal', message, Object.keys(context).length > 0 ? context : undefined),
        );
        return false; // let the browser's default error handling continue
    };

    // window.onunhandledrejection → level: 'error'
    window.onunhandledrejection = (event: PromiseRejectionEvent): void => {
        const reason: unknown = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        const context: Record<string, unknown> = {};
        if (reason instanceof Error && reason.stack !== undefined) {
            context['stack'] = reason.stack;
        }
        logsApi.emit(
            makeEntry(
                'error',
                `Unhandled rejection: ${message}`,
                Object.keys(context).length > 0 ? context : undefined,
            ),
        );
    };
}
