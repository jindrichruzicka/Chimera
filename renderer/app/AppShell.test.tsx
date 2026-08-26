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
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia } from '../__test-support__/installMatchMedia';
import { createRecordingLogsApi } from '../logging/__test-support__/RecordingLogsApi';
import { selectPendingConfirm, useConfirmDialogStore } from '../state/confirmDialogStore';
import { _resetShellStateForTest, getShellState } from '../shell/shellStateStore';
import { AppShell } from './AppShell';

const audioMocks = vi.hoisted(() => ({
    createAudioManager: vi.fn(() => {
        throw new Error('AudioContext unavailable');
    }),
}));

vi.mock('../audio/AudioManager', () => ({
    createAudioManager: audioMocks.createAudioManager,
}));

const navigationState = { pathname: '/', search: '' };

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    usePathname: () => navigationState.pathname,
    useSearchParams: () => new URLSearchParams(navigationState.search),
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
    navigationState.pathname = '/';
    navigationState.search = '';
    window.history.replaceState({}, '', '/');
    _resetShellStateForTest();

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

// ── The single confirm surface ────────────────────────────────────────────────
//
// `useConfirmDialog()` hands back a promise that only a mounted host can settle,
// so "AppShell mounts exactly one ConfirmDialogHost" is not a detail of the tree
// — it is what makes the hook work on every route. Asserting through the shell
// (rather than on the host in isolation) is what catches the host being dropped
// from this composition root.
describe('AppShell — confirm surface', () => {
    afterEach(() => {
        for (const entry of useConfirmDialogStore.getState().queue) {
            useConfirmDialogStore.getState().settle(entry.id, false);
        }
    });

    it('shows a queued confirm request, so a request made on any route reaches a host', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        render(
            <AppShell>
                <main />
            </AppShell>,
        );

        act(() => {
            void useConfirmDialogStore.getState().request({ title: 'Overwrite your save?' });
        });

        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('Overwrite your save?')).toBeInTheDocument();
    });

    it('mounts exactly one host — a second surface would answer the same question twice', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        render(
            <AppShell>
                <main />
            </AppShell>,
        );

        act(() => {
            void useConfirmDialogStore.getState().request({ title: 'Overwrite your save?' });
        });

        expect(screen.getAllByTestId('confirm-dialog')).toHaveLength(1);
    });

    it('settles the request from the shell-mounted host', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        render(
            <AppShell>
                <main />
            </AppShell>,
        );

        let answer!: Promise<boolean>;
        act(() => {
            answer = useConfirmDialogStore.getState().request({ title: 'Overwrite your save?' });
        });

        act(() => {
            screen.getByTestId('confirm-dialog-confirm').click();
        });

        await expect(answer).resolves.toBe(true);
        expect(selectPendingConfirm(useConfirmDialogStore.getState())).toBeNull();
    });
});

describe('AppShell — shell-state bridge', () => {
    it('mounts the bridge, so every consumer under the shell reads one classified route', () => {
        // Driven off the boot route on purpose: the store's INITIAL value is
        // `{surface: 'boot', pathname: '/'}`, which is exactly what the bridge
        // publishes for `/`. A case that stayed there could not tell a mounted
        // bridge from an absent one.
        navigationState.pathname = '/main-menu';
        navigationState.search = 'gameId=tactics';
        window.history.replaceState({}, '', '/main-menu?gameId=tactics');

        render(
            <AppShell>
                <div />
            </AppShell>,
        );

        expect(getShellState()).toMatchObject({
            surface: 'main-menu',
            pathname: '/main-menu',
            gameId: 'tactics',
        });
    });

    it('keeps publishing after a route change, so the shell follows the router', () => {
        navigationState.pathname = '/main-menu';
        window.history.replaceState({}, '', '/main-menu');
        const view = render(
            <AppShell>
                <div />
            </AppShell>,
        );
        expect(getShellState().surface).toBe('main-menu');

        navigationState.pathname = '/settings';
        window.history.replaceState({}, '', '/settings');
        view.rerender(
            <AppShell>
                <div />
            </AppShell>,
        );

        expect(getShellState().surface).toBe('settings');
    });
});
