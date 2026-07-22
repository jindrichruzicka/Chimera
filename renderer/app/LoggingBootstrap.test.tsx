// @vitest-environment jsdom
// renderer/app/LoggingBootstrap.test.tsx
//
// The bridge is installed during render, not in an effect (§4.27) — an effect
// runs after every parent has already rendered. These tests pin the properties
// that a render-phase install has to carry on its own: idempotency, re-arming
// after StrictMode's simulated remount (every Next host in the tree sets
// reactStrictMode: true — apps/<game>/renderer/next.config.ts and the scaffold
// template), ownership discipline against an already-installed bridge, and an
// exact teardown.

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingLogsApi } from '../logging/__test-support__/RecordingLogsApi';
import { installRendererLogger } from '../logging/rendererLogger';
import { LoggingBootstrap } from './LoggingBootstrap';

function setLogsApi(logs: unknown): void {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: { logs },
    });
}

let logsApi: ReturnType<typeof createRecordingLogsApi>;
let originalWarn: typeof console.warn;
let originalError: typeof console.error;

beforeEach(() => {
    originalWarn = console.warn;
    originalError = console.error;
    logsApi = createRecordingLogsApi();
    setLogsApi(logsApi);
});

afterEach(() => {
    cleanup();
    console.warn = originalWarn;
    console.error = originalError;
    delete (window as unknown as Record<string, unknown>)['__chimera'];
    vi.restoreAllMocks();
});

describe('LoggingBootstrap', () => {
    it('patches console.warn during its own render, before any sibling renders', () => {
        let warnDuringSiblingRender: typeof console.warn | undefined;

        function SiblingProbe(): null {
            warnDuringSiblingRender = console.warn;
            return null;
        }

        render(
            <>
                <LoggingBootstrap />
                <SiblingProbe />
            </>,
        );

        expect(warnDuringSiblingRender).toBeDefined();
        expect(warnDuringSiblingRender).not.toBe(originalWarn);
    });

    it('keeps forwarding after StrictMode remounts the effect', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        render(
            <React.StrictMode>
                <LoggingBootstrap />
            </React.StrictMode>,
        );

        console.warn('after strict remount');

        expect(logsApi.emit).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'warn',
                message: expect.stringContaining('after strict remount'),
            }),
        );
    });

    it('installs the bridge exactly once across a StrictMode double render', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        render(
            <React.StrictMode>
                <LoggingBootstrap />
            </React.StrictMode>,
        );

        console.warn('single forward');

        const forwards = logsApi.emitCalls.filter((entry) =>
            entry.message.includes('single forward'),
        );
        expect(forwards).toHaveLength(1);
    });

    it('restores both original console methods and removes window listeners on unmount', () => {
        const rendered = render(<LoggingBootstrap />);
        expect(console.warn).not.toBe(originalWarn);
        expect(console.error).not.toBe(originalError);

        rendered.unmount();

        expect(console.warn).toBe(originalWarn);
        expect(console.error).toBe(originalError);
        // The teardown is exact: both window listeners go with the console
        // patches, so post-unmount events forward nothing. The error event is
        // message-only on purpose — with no 'error' listener left, vitest
        // reports a dispatched event carrying an `error` payload as an
        // uncaught exception; a leaked listener would still emit from message.
        window.dispatchEvent(new ErrorEvent('error', { message: 'late' }));
        window.dispatchEvent(
            new PromiseRejectionEvent('unhandledrejection', {
                promise: Promise.resolve(),
                reason: 'late rejection',
            }),
        );
        expect(logsApi.emit).not.toHaveBeenCalled();
    });

    // installRendererLogger returns null when the bridge is already installed;
    // the bootstrap must not mistake that refusal for ownership. Reachable in
    // dev via Fast Refresh: this module re-evaluates (its claim resets) while
    // rendererLogger.ts keeps its `installed` latch from the prior owner.
    it('does not claim a bridge another owner installed, and recovers once that owner tears down', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const silencedWarn = console.warn;

        const externalStub = createRecordingLogsApi();
        const externalTeardown = installRendererLogger(externalStub);
        expect(externalTeardown).not.toBeNull();

        const rendered = render(<LoggingBootstrap />);

        // The external owner tears down while the bootstrap is mounted…
        externalTeardown?.();
        expect(console.warn).toBe(silencedWarn);

        // …and the next render re-installs for the bootstrap's own logsApi —
        // a stale claim on the owner's no-op teardown would block this forever.
        rendered.rerender(<LoggingBootstrap />);
        console.warn('after external teardown');
        expect(logsApi.emitCalls.map((entry) => entry.message)).toContain(
            'after external teardown',
        );

        // Now the bootstrap owns the patch, so unmount restores.
        rendered.unmount();
        expect(console.warn).toBe(silencedWarn);
    });

    it('keeps the bridge installed until the last mounted bootstrap unmounts', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const silencedWarn = console.warn;

        const first = render(<LoggingBootstrap />);
        const second = render(<LoggingBootstrap />);

        first.unmount();
        console.warn('one bootstrap still mounted');
        expect(logsApi.emitCalls.map((entry) => entry.message)).toContain(
            'one bootstrap still mounted',
        );

        second.unmount();
        expect(console.warn).toBe(silencedWarn);
    });

    it('reinstalls after a full unmount/remount cycle', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const spiedWarn = console.warn;

        render(<LoggingBootstrap />).unmount();
        expect(console.warn).toBe(spiedWarn);

        render(<LoggingBootstrap />);
        console.warn('second mount');

        expect(logsApi.emit).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('second mount'),
            }),
        );
    });

    it('renders without installing when the preload logs bridge is unavailable', () => {
        delete (window as unknown as Record<string, unknown>)['__chimera'];

        expect(() => render(<LoggingBootstrap />)).not.toThrow();
        expect(console.warn).toBe(originalWarn);
    });

    it('renders without installing when __chimera.logs has the wrong shape', () => {
        setLogsApi({ emit: 'not a function' });

        expect(() => render(<LoggingBootstrap />)).not.toThrow();
        expect(console.warn).toBe(originalWarn);
    });
});
