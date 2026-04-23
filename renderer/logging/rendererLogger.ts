// renderer/logging/rendererLogger.ts
//
// Renderer-side structured logger (§4.27). Hooks console.warn, console.error,
// window.addEventListener('error'), and window.addEventListener('unhandledrejection'),
// forwarding entries to the main process via the window.__chimera.logs IPC channel.
//
// Must NOT import from electron/, simulation/, or games/*.
// Uses globalThis.__chimera?.logs for root-tsconfig compatibility (no DOM).
// The renderer tsconfig has DOM, so `window` is valid in renderer source.

import type { LogEntry } from '@chimera/shared/logging.js';
import type { LogsAPI } from '@chimera/electron/preload/api-types.js';

// Ambient declarations so the root tsconfig (no DOM lib) can type-check this
// file. The renderer tsconfig (lib: ["ES2022","DOM"]) provides the full types.
declare const window: {
    addEventListener(type: string, listener: (event: Event) => void): void;
};

interface ErrorEvent extends Event {
    readonly message: string;
    readonly error?: unknown;
}

interface PromiseRejectionEvent extends Event {
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
 * Uses addEventListener so pre-existing handlers installed by Next.js,
 * React DevTools, or other libraries are composed rather than clobbered.
 * All logsApi.emit calls are wrapped in try/catch to prevent re-entry if
 * the IPC bridge itself throws.
 *
 * Call once during renderer boot (before React hydration). Calling twice
 * compounds the hooks — use installRendererLogger idempotently or guard
 * at the call site.
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
    window.addEventListener('error', (event: Event) => {
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
    });

    // window 'unhandledrejection' event → level: 'error'
    window.addEventListener('unhandledrejection', (event: Event) => {
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
    });
}
