// @vitest-environment jsdom
// renderer/app/AppShell.test.tsx
//
// Pins the renderer logging bridge's install ordering (§4.27, Invariant #67).
//
// Unlike layout.test.tsx — which mocks ../logging/rendererLogger wholesale to
// assert the wiring — this file runs the REAL patch, because the property under
// test is *when* console.warn is replaced relative to <Providers>' render. A
// mocked installer cannot observe that.
//
// The live case is `createAudioManagerForEnvironment` (providers.tsx), which
// warns from a useMemo initializer during render. React runs a parent's render
// strictly before any child's effect, so an effect-scoped install inside
// <Providers> misses this warn — it reaches devtools and never the log file a
// packaged binary leaves behind.

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia } from '../__test-support__/installMatchMedia';
import { createRecordingLogsApi } from '../logging/__test-support__/RecordingLogsApi';
import { AppShell } from './AppShell';

const audioMocks = vi.hoisted(() => ({
    createAudioManager: vi.fn(() => {
        throw new Error('AudioContext unavailable');
    }),
}));

vi.mock('../audio/AudioManager', () => ({
    createAudioManager: audioMocks.createAudioManager,
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

const TOAST_ID = '00000000-0000-4000-8000-000000000001';

let logsApi: ReturnType<typeof createRecordingLogsApi>;
let originalWarn: typeof console.warn;
let originalError: typeof console.error;

beforeEach(() => {
    originalWarn = console.warn;
    originalError = console.error;
    logsApi = createRecordingLogsApi();
    audioMocks.createAudioManager.mockClear();

    vi.useFakeTimers();
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => TOAST_ID) });
    vi.spyOn(performance, 'now').mockReturnValue(0);
    installMatchMedia();

    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            system: { onConnectionStatus: vi.fn(() => () => undefined) },
            logs: logsApi,
        },
    });
});

afterEach(() => {
    // cleanup() unmounts, which runs the bootstrap's teardown and restores the
    // console methods; the assignments below are a safety net for a test that
    // asserts on a broken teardown.
    cleanup();
    console.warn = originalWarn;
    console.error = originalError;
    delete (window as unknown as Record<string, unknown>)['__chimera'];
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('AppShell — renderer logging install ordering', () => {
    it('forwards a warn emitted during Providers render to the logs IPC surface', () => {
        // Silence the mirrored output. Spying BEFORE render is deliberate: the
        // patch wraps whatever console.warn is installed at that moment, so the
        // forward still happens while the terminal stays quiet.
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        render(
            <AppShell>
                <main />
            </AppShell>,
        );

        expect(audioMocks.createAudioManager).toHaveBeenCalled();
        expect(logsApi.emit).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'warn',
                message: expect.stringContaining('AudioManager initialization failed'),
                source: expect.objectContaining({ process: 'renderer' }),
            }),
        );
    });

    // Every Next host in the tree sets reactStrictMode: true
    // (apps/<game>/renderer/next.config.ts and the scaffold template), so this
    // — not the bare render above — is the configuration a dev launch runs.
    // The render-phase warn cannot discriminate here: it fires before any
    // StrictMode cleanup. What StrictMode uniquely threatens is the RE-ARM —
    // mount → cleanup → mount tears the bridge down between effect passes — so
    // only a log emitted AFTER render() returns can prove the bridge survived.
    it('still forwards a warn emitted after StrictMode remounts every effect', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        render(
            <React.StrictMode>
                <AppShell>
                    <main />
                </AppShell>
            </React.StrictMode>,
        );

        console.warn('emitted after the StrictMode remount');

        expect(
            logsApi.emitCalls.some((entry) =>
                entry.message.includes('emitted after the StrictMode remount'),
            ),
        ).toBe(true);
    });

    it('carries the failure Error through to LogEntry.error rather than flattening it', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        render(
            <AppShell>
                <main />
            </AppShell>,
        );

        const audioEntry = logsApi.emitCalls.find((entry) =>
            entry.message.includes('AudioManager initialization failed'),
        );
        expect(audioEntry?.error?.message).toBe('AudioContext unavailable');
        expect(audioEntry?.error?.stack).toBeDefined();
    });

    it('restores the original console methods when the shell unmounts', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const patchedOver = console.warn;

        const rendered = render(
            <AppShell>
                <main />
            </AppShell>,
        );
        expect(console.warn).not.toBe(patchedOver);

        rendered.unmount();

        expect(console.warn).toBe(patchedOver);
    });
});
