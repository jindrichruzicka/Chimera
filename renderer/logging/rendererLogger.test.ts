// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LogsAPI } from '@chimera/electron/preload/api-types.js';
import { installRendererLogger } from './rendererLogger.js';

// jsdom provides window/PromiseRejectionEvent at runtime; these declarations
// let the root tsconfig (no DOM lib) type-check this file.
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

    beforeEach(() => {
        logsApi = makeLogsApi();
    });

    it('console.error triggers logsApi.emit with level error', () => {
        installRendererLogger(logsApi);
        console.error('test error');
        expect(logsApi.emit).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'error',
                message: expect.stringContaining('test error'),
            }),
        );
    });

    it('console.warn triggers logsApi.emit with level warn', () => {
        installRendererLogger(logsApi);
        console.warn('test warning');
        expect(logsApi.emit).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'warn',
                message: expect.stringContaining('test warning'),
            }),
        );
    });

    it('console.log does NOT trigger logsApi.emit', () => {
        installRendererLogger(logsApi);
        const callsBefore = (logsApi.emit as ReturnType<typeof vi.fn>).mock.calls.length;
        console.log('should not be forwarded');
        expect((logsApi.emit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    });

    it('window.onerror handler calls logsApi.emit with level fatal', () => {
        installRendererLogger(logsApi);
        // Simulate a global error event
        window.onerror?.('uncaught error', 'test.js', 10, 5, new Error('fatal'));
        expect(logsApi.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'fatal' }));
    });

    it('window.onunhandledrejection triggers logsApi.emit with level error', () => {
        installRendererLogger(logsApi);
        const event = { reason: new Error('rejected') } as PromiseRejectionEvent;
        window.onunhandledrejection?.(event);
        expect(logsApi.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    });

    it('emitted entries have source.process = renderer', () => {
        installRendererLogger(logsApi);
        console.error('source test');
        const call = (logsApi.emit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
        expect(call?.source?.process).toBe('renderer');
    });
});
