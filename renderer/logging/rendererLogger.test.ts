// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LogsAPI } from '@chimera/simulation/bridge/api-types.js';
import { installRendererLogger } from './rendererLogger.js';

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

function makeLogsApi(): LogsAPI & { emitCalls: Parameters<LogsAPI['emit']>[] } {
    const emitCalls: Parameters<LogsAPI['emit']>[] = [];
    return {
        emit: vi.fn((entry) => {
            emitCalls.push([entry]);
        }),
        readRecent: vi.fn(() => Promise.resolve([])),
        emitCalls,
    };
}

describe('installRendererLogger', () => {
    let logsApi: ReturnType<typeof makeLogsApi>;
    let origWarn: typeof console.warn;
    let origError: typeof console.error;
    let teardown: (() => void) | undefined;

    beforeEach(() => {
        logsApi = makeLogsApi();
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

    it('console.log does NOT trigger logsApi.emit', () => {
        teardown = installRendererLogger(logsApi);
        const callsBefore = (logsApi.emit as ReturnType<typeof vi.fn>).mock.calls.length;
        console.log('should not be forwarded');
        expect((logsApi.emit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
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
        td();
        // After teardown, console methods should be the originals again
        expect(console.warn).toBe(origWarn);
        expect(console.error).toBe(origError);
    });

    it('teardown allows reinstalling (idempotent guard resets)', () => {
        const td = installRendererLogger(logsApi);
        td(); // teardown resets `installed` flag
        const logsApi2 = makeLogsApi();
        const td2 = installRendererLogger(logsApi2);
        console.error('reinstalled');
        expect(logsApi2.emit).toHaveBeenCalledTimes(1);
        td2();
    });
});
