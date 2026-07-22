// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LogsAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import { createRecordingLogsApi } from './__test-support__/RecordingLogsApi.js';
import { emitRendererError, installRendererLogger } from './rendererLogger.js';

// jsdom provides window/PromiseRejectionEvent at runtime; these declarations
// let the root tsconfig (no DOM lib) type-check this file.
declare const window: {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
    dispatchEvent(event: Event): boolean;
};

interface ErrorEvent extends Event {
    readonly message: string;
    readonly error?: unknown;
}
declare const ErrorEvent: new (
    type: string,
    init?: { message?: string; error?: unknown },
) => ErrorEvent;

interface PromiseRejectionEvent extends Event {
    readonly reason: unknown;
}
declare const PromiseRejectionEvent: new (
    type: string,
    init: { promise: Promise<unknown>; reason: unknown },
) => PromiseRejectionEvent;

describe('installRendererLogger', () => {
    let logsApi: ReturnType<typeof createRecordingLogsApi>;
    let origWarn: typeof console.warn;
    let origError: typeof console.error;
    let teardown: (() => void) | null | undefined;

    beforeEach(() => {
        logsApi = createRecordingLogsApi();
        origWarn = console.warn;
        origError = console.error;
        teardown = undefined;
    });

    afterEach(() => {
        teardown?.();
        // Restore in case teardown didn't (should not be needed, but safety net)
        console.warn = origWarn;
        console.error = origError;
    });

    it('console.error triggers logsApi.emit with level error', () => {
        teardown = installRendererLogger(logsApi);
        console.error('test error');
        expect(logsApi.emit).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('test error'),
            }),
        );
    });

    it('console.warn triggers logsApi.emit with level warn', () => {
        teardown = installRendererLogger(logsApi);
        console.warn('test warning');
        expect(logsApi.emit).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'warn',
                message: expect.stringContaining('test warning'),
            }),
        );
    });

    // §4.27: console.log is preserved locally but deliberately NOT forwarded
    // (PII/volume hygiene). This test is the only thing pinning that policy — a
    // later "the bridge should catch everything" change must fail here rather
    // than quietly reverse it. Call sites that need a durable record move up to
    // warn/error instead.
    it('console.log does NOT trigger logsApi.emit', () => {
        teardown = installRendererLogger(logsApi);
        const callsBefore = (logsApi.emit as ReturnType<typeof vi.fn>).mock.calls.length;
        console.log('should not be forwarded');
        expect((logsApi.emit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    });

    // The threaded Error travels once, in LogEntry.error — it is removed from
    // the composed message while the remaining args still compose it, so the
    // main-process logger does not print the error text twice.
    it('console.error carries an Error argument through to LogEntry.error with its stack', () => {
        teardown = installRendererLogger(logsApi);
        const cause = new Error('x');

        console.error('boom', cause);

        const entry = logsApi.emitCalls[0];
        expect(entry?.message).toBe('boom');
        expect(entry?.error?.name).toBe('Error');
        expect(entry?.error?.message).toBe('x');
        expect(entry?.error?.stack).toBeDefined();
    });

    it('console.warn carries an Error argument through to LogEntry.error with its stack', () => {
        teardown = installRendererLogger(logsApi);
        const cause = new TypeError('bad shape');

        console.warn('[Providers] init failed', cause);

        const entry = logsApi.emitCalls[0];
        expect(entry?.message).toBe('[Providers] init failed');
        expect(entry?.error?.name).toBe('TypeError');
        expect(entry?.error?.message).toBe('bad shape');
        expect(entry?.error?.stack).toBeDefined();
    });

    it('threads the first Error; later Errors stay in the message text', () => {
        teardown = installRendererLogger(logsApi);

        console.error('two', new Error('first'), new Error('second'));

        const entry = logsApi.emitCalls[0];
        expect(entry?.error?.message).toBe('first');
        expect(entry?.message).toBe('two Error: second');
    });

    it('composes the message from the Error itself when it is the only argument', () => {
        teardown = installRendererLogger(logsApi);

        console.error(new Error('solo'));

        const entry = logsApi.emitCalls[0];
        expect(entry?.message).toBe('Error: solo');
        expect(entry?.error?.message).toBe('solo');
        expect(entry?.error?.stack).toBeDefined();
    });

    // Negative control: without an Error argument the entry must stay
    // error-free, so the assertions above cannot pass on a blanket payload.
    it('leaves LogEntry.error undefined for string-only console calls', () => {
        teardown = installRendererLogger(logsApi);

        console.error('plain', 42, { shape: 'not an error' });

        const entry = logsApi.emitCalls[0];
        expect(entry?.message).toContain('plain');
        expect(entry?.error).toBeUndefined();
    });

    // The chimera:logs:emit schema caps these fields (name 256 / message 4096 /
    // stack 8192) and its handler DROPS a failing entry rather than truncating
    // it, so the renderer must truncate first — an oversized stack must cost
    // characters, never the whole entry.
    it('truncates oversized error fields to the emit schema caps', () => {
        teardown = installRendererLogger(logsApi);
        const err = new Error('m'.repeat(5000));
        err.name = 'N'.repeat(300);
        err.stack = 's'.repeat(10_000);

        console.error('big', err);

        const entry = logsApi.emitCalls[0];
        expect(entry?.error?.name).toHaveLength(256);
        expect(entry?.error?.message).toHaveLength(4096);
        expect(entry?.error?.stack).toHaveLength(8192);
    });

    it('truncates an oversized composed message to the emit schema cap', () => {
        teardown = installRendererLogger(logsApi);

        console.warn('x'.repeat(5000));

        expect(logsApi.emitCalls[0]?.message).toHaveLength(4096);
    });

    it('returns null on a second call so a caller cannot claim ownership it does not hold', () => {
        teardown = installRendererLogger(logsApi);

        expect(installRendererLogger(logsApi)).toBeNull();
    });

    it('teardown removes the window error and unhandledrejection listeners', () => {
        const td = installRendererLogger(logsApi);
        td?.();

        // message-only on purpose: with the bridge's listener removed there is
        // no 'error' listener left, and vitest reports a dispatched event that
        // carries an `error` payload as an uncaught exception. A leaked bridge
        // listener would still emit fatal from the message alone.
        window.dispatchEvent(new ErrorEvent('error', { message: 'late' }));
        window.dispatchEvent(
            new PromiseRejectionEvent('unhandledrejection', {
                promise: Promise.resolve(),
                reason: 'late',
            }),
        );

        expect(logsApi.emit).not.toHaveBeenCalled();
    });

    it('window error event calls logsApi.emit with level fatal', () => {
        teardown = installRendererLogger(logsApi);
        const err = new Error('fatal');
        const event = new ErrorEvent('error', { message: 'fatal', error: err });
        window.dispatchEvent(event);
        expect(logsApi.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'fatal' }));
    });

    it('window unhandledrejection event triggers logsApi.emit with level error', () => {
        teardown = installRendererLogger(logsApi);
        const event = new PromiseRejectionEvent('unhandledrejection', {
            promise: Promise.resolve(),
            reason: new Error('rejected'),
        });
        window.dispatchEvent(event);
        expect(logsApi.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    });

    // The window handlers report their stack through `context.stack` rather
    // than `LogEntry.error` (§4.27). The schema bounds `context`'s shape but
    // not its size, so an oversized stack there cannot cost the entry — but it
    // is the same class of unbounded renderer-supplied data the `error` fields
    // are capped for, so the bridge bounds every string it composes itself, on
    // both routes.
    it('truncates an oversized stack on the window error route', () => {
        teardown = installRendererLogger(logsApi);
        const err = new Error('fatal');
        err.stack = 's'.repeat(10_000);

        window.dispatchEvent(new ErrorEvent('error', { message: 'fatal', error: err }));

        expect(logsApi.emitCalls[0]?.context?.['stack']).toHaveLength(8192);
    });

    it('truncates an oversized stack on the unhandled-rejection route', () => {
        teardown = installRendererLogger(logsApi);
        const reason = new Error('rejected');
        reason.stack = 's'.repeat(10_000);

        window.dispatchEvent(
            new PromiseRejectionEvent('unhandledrejection', {
                promise: Promise.resolve(),
                reason,
            }),
        );

        expect(logsApi.emitCalls[0]?.context?.['stack']).toHaveLength(8192);
    });

    it('emitted entries have source.process = renderer', () => {
        teardown = installRendererLogger(logsApi);
        console.error('source test');
        const call = (logsApi.emit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
        expect(call?.source?.process).toBe('renderer');
    });

    it('does not replace a pre-existing window error handler (addEventListener composes)', () => {
        const spy = vi.fn();
        window.addEventListener('error', spy);
        teardown = installRendererLogger(logsApi);
        const event = new ErrorEvent('error', {
            message: 'compose test',
            error: new Error('compose test'),
        });
        window.dispatchEvent(event);
        expect(spy).toHaveBeenCalled();
        expect(logsApi.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'fatal' }));
    });

    it('logsApi.emit throwing does not propagate out of the error handler', () => {
        const throwingApi: LogsAPI = {
            emit: vi.fn(() => {
                throw new Error('emit blew up');
            }),
            readRecent: vi.fn(() => Promise.resolve([])),
        };
        teardown = installRendererLogger(throwingApi);
        expect(() => {
            const event = new ErrorEvent('error', { message: 'boom', error: new Error('boom') });
            window.dispatchEvent(event);
        }).not.toThrow();
    });

    it('logsApi.emit throwing in console.error does not propagate', () => {
        const throwingApi: LogsAPI = {
            emit: vi.fn(() => {
                throw new Error('emit blew up');
            }),
            readRecent: vi.fn(() => Promise.resolve([])),
        };
        teardown = installRendererLogger(throwingApi);
        expect(() => {
            console.error('should not throw');
        }).not.toThrow();
    });

    it('calling installRendererLogger twice does not double-wrap console.error', () => {
        teardown = installRendererLogger(logsApi);
        installRendererLogger(logsApi); // second call should be a no-op
        console.error('once only');
        expect(logsApi.emit).toHaveBeenCalledTimes(1);
    });

    it('teardown restores original console.warn and console.error', () => {
        const td = installRendererLogger(logsApi);
        td?.();
        // After teardown, console methods should be the originals again
        expect(console.warn).toBe(origWarn);
        expect(console.error).toBe(origError);
    });

    it('teardown allows reinstalling (idempotent guard resets)', () => {
        const td = installRendererLogger(logsApi);
        td?.(); // teardown resets `installed` flag
        const logsApi2 = createRecordingLogsApi();
        const td2 = installRendererLogger(logsApi2);
        console.error('reinstalled');
        expect(logsApi2.emit).toHaveBeenCalledTimes(1);
        td2?.();
    });
});

describe('emitRendererError', () => {
    // `source.module` is capped at the `chimera:logs:emit` schema, and the
    // handler DROPS an entry that fails validation rather than truncating it,
    // so an oversized module name must cost characters here, never the entry.
    // The interception routes always pass the 'global' literal; this is the
    // only route where the value is a caller's.
    it('truncates an oversized module name', () => {
        const logsApi = createRecordingLogsApi();

        emitRendererError(logsApi, 'boom', new Error('x'), undefined, 'M'.repeat(500));

        expect(logsApi.emitCalls[0]?.source.module).toHaveLength(256);
    });

    it('leaves a module name within the cap untouched', () => {
        const logsApi = createRecordingLogsApi();

        emitRendererError(logsApi, 'boom', new Error('x'), undefined, 'RootErrorBoundary');

        expect(logsApi.emitCalls[0]?.source.module).toBe('RootErrorBoundary');
    });
});
