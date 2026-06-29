// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplayAPI } from '@chimera-engine/simulation/bridge/api-types.js';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

import { ReplayNavigationBridge } from './ReplayNavigationBridge';

function installReplayBridge(replay: Partial<ReplayAPI>): void {
    Object.defineProperty(window, '__chimera', { configurable: true, value: { replay } });
}

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    mockPush.mockClear();
    vi.restoreAllMocks();
    // Some tests set a `?gameId=` URL; reset so the no-gameId cases above see a
    // bare location (jsdom default `http://localhost/`).
    window.history.replaceState({}, '', '/');
});

describe('ReplayNavigationBridge', () => {
    it('pushes a deterministic replay to the player route with kind=deterministic', () => {
        const onNavigate = vi.fn(
            (_listener: (payload: { path: string; kind: string; saveable: boolean }) => void) =>
                () =>
                    undefined,
        );
        installReplayBridge({ onNavigate });

        render(<ReplayNavigationBridge />);

        expect(onNavigate).toHaveBeenCalledOnce();
        const listener = onNavigate.mock.calls[0]?.[0];
        listener?.({
            path: '/replays/tactics/abc.chimera-replay',
            kind: 'deterministic',
            saveable: false,
        });

        expect(mockPush).toHaveBeenCalledWith(
            `/replays/player/?path=${encodeURIComponent('/replays/tactics/abc.chimera-replay')}&kind=deterministic`,
        );
    });

    it('pushes a perspective replay to the player route with kind=perspective', () => {
        const onNavigate = vi.fn(
            (_listener: (payload: { path: string; kind: string; saveable: boolean }) => void) =>
                () =>
                    undefined,
        );
        installReplayBridge({ onNavigate });

        render(<ReplayNavigationBridge />);

        const listener = onNavigate.mock.calls[0]?.[0];
        listener?.({
            path: '/perspective-replays/tactics/abc.chimera-perspective-replay',
            kind: 'perspective',
            saveable: false,
        });

        expect(mockPush).toHaveBeenCalledWith(
            `/replays/player/?path=${encodeURIComponent('/perspective-replays/tactics/abc.chimera-perspective-replay')}&kind=perspective`,
        );
    });

    it('forwards the saveable flag as &saveable=1 for a just-finished match', () => {
        const onNavigate = vi.fn(
            (_listener: (payload: { path: string; kind: string; saveable: boolean }) => void) =>
                () =>
                    undefined,
        );
        installReplayBridge({ onNavigate });

        render(<ReplayNavigationBridge />);

        const listener = onNavigate.mock.calls[0]?.[0];
        listener?.({
            path: '/replays/tactics/abc.chimera-replay',
            kind: 'deterministic',
            saveable: true,
        });

        expect(mockPush).toHaveBeenCalledWith(
            `/replays/player/?path=${encodeURIComponent('/replays/tactics/abc.chimera-replay')}&kind=deterministic&saveable=1`,
        );
    });

    it('carries the active ?gameId= from the current URL onto the player route', () => {
        // The shell (incl. the main-menu override) resolves only from `?gameId=`.
        // Entering the player from a live match (`/game?gameId=tactics`) must carry
        // it forward, or leaving the replay drops back to the engine-default menu.
        window.history.replaceState({}, '', '/game?gameId=tactics');
        const onNavigate = vi.fn(
            (_listener: (payload: { path: string; kind: string; saveable: boolean }) => void) =>
                () =>
                    undefined,
        );
        installReplayBridge({ onNavigate });

        render(<ReplayNavigationBridge />);

        const listener = onNavigate.mock.calls[0]?.[0];
        listener?.({
            path: '/replays/tactics/abc.chimera-replay',
            kind: 'deterministic',
            saveable: false,
        });

        expect(mockPush).toHaveBeenCalledWith(
            `/replays/player/?path=${encodeURIComponent('/replays/tactics/abc.chimera-replay')}&kind=deterministic&gameId=tactics`,
        );
    });

    it('carries ?gameId= alongside the saveable flag for a just-finished match', () => {
        window.history.replaceState({}, '', '/game?gameId=tactics');
        const onNavigate = vi.fn(
            (_listener: (payload: { path: string; kind: string; saveable: boolean }) => void) =>
                () =>
                    undefined,
        );
        installReplayBridge({ onNavigate });

        render(<ReplayNavigationBridge />);

        const listener = onNavigate.mock.calls[0]?.[0];
        listener?.({
            path: '/replays/tactics/abc.chimera-replay',
            kind: 'deterministic',
            saveable: true,
        });

        expect(mockPush).toHaveBeenCalledWith(
            `/replays/player/?path=${encodeURIComponent('/replays/tactics/abc.chimera-replay')}&kind=deterministic&saveable=1&gameId=tactics`,
        );
    });

    it('unsubscribes on unmount', () => {
        const unsubscribe = vi.fn();
        installReplayBridge({ onNavigate: vi.fn(() => unsubscribe) });

        const { unmount } = render(<ReplayNavigationBridge />);
        expect(unsubscribe).not.toHaveBeenCalled();
        unmount();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('renders nothing and no-ops when the bridge is absent', () => {
        const { container } = render(<ReplayNavigationBridge />);
        expect(container).toBeEmptyDOMElement();
    });
});
