// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    PlayerSnapshot,
    ReplayAPI,
    ReplayPlaybackInfo,
} from '@chimera/electron/preload/api-types.js';

// Stub the game renderer loader so the player page does not pull in real
// games/* screen modules under test.
vi.mock('@chimera/renderer/game/rendererGameRegistry', () => ({
    loadRendererGame: vi.fn(() => Promise.resolve({ registry: { screens: {} } })),
}));

// Stub GameShell — we only assert which snapshot it receives, not how it draws.
vi.mock('@chimera/renderer/components/shell/GameShell', () => ({
    GameShell: ({ snapshot }: { snapshot?: PlayerSnapshot }) => (
        <div data-testid="game-shell" data-tick={snapshot?.tick ?? 'none'} />
    ),
}));

import ReplayPlayerPage from './page';

const PATH = '/replays/tactics/match.chimera-replay';

const INFO: ReplayPlaybackInfo = {
    gameId: 'tactics',
    totalTicks: 5,
    playerIds: ['p1', 'p2'],
    viewerId: 'p1',
};

function snapshotAtTick(tick: number): PlayerSnapshot {
    return { tick, viewerId: 'p1' } as unknown as PlayerSnapshot;
}

function snapshotsForRange(from: number, to: number): PlayerSnapshot[] {
    return Array.from({ length: to - from + 1 }, (_unused, i) => snapshotAtTick(from + i));
}

function installReplayBridge(replay: Partial<ReplayAPI>): void {
    Object.defineProperty(window, '__chimera', { configurable: true, value: { replay } });
}

function makeBridge(overrides: Partial<ReplayAPI> = {}): Partial<ReplayAPI> {
    return {
        openPlayback: vi.fn(() => Promise.resolve(INFO)),
        snapshotRange: vi.fn((from: number, to: number) =>
            Promise.resolve(snapshotsForRange(from, to)),
        ),
        closePlayback: vi.fn(() => Promise.resolve()),
        ...overrides,
    };
}

beforeEach(() => {
    window.history.replaceState({}, '', `/replays/player?path=${encodeURIComponent(PATH)}`);
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('ReplayPlayerPage', () => {
    it('opens playback for the path and prefetches a range from tick 0', async () => {
        const bridge = makeBridge();
        installReplayBridge(bridge);

        render(<ReplayPlayerPage />);

        await waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '0');
        });
        expect(bridge.openPlayback).toHaveBeenCalledWith(PATH);
        // Fetches a buffer of ticks in one round-trip, anchored at tick 0.
        expect(bridge.snapshotRange).toHaveBeenCalledWith(0, expect.any(Number));
    });

    it('shows the current and total ticks from the playback info', async () => {
        installReplayBridge(makeBridge());

        render(<ReplayPlayerPage />);

        await waitFor(() => {
            expect(screen.getByText(/0\s*\/\s*5/)).toBeInTheDocument();
        });
    });

    it('steps forward, showing the next tick from the prefetched buffer', async () => {
        const bridge = makeBridge();
        installReplayBridge(bridge);

        render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');

        await userEvent.click(screen.getByRole('button', { name: /step forward/i }));

        await waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '1');
        });
        // The whole replay (5 ticks) fits one prefetch — no second round-trip.
        expect(bridge.snapshotRange).toHaveBeenCalledTimes(1);
    });

    it('advancing across the buffered range issues a single snapshotRange', async () => {
        const bridge = makeBridge();
        installReplayBridge(bridge);

        render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');

        const forward = screen.getByRole('button', { name: /step forward/i });
        await userEvent.click(forward);
        await userEvent.click(forward);
        await userEvent.click(forward);

        await waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '3');
        });
        expect(bridge.snapshotRange).toHaveBeenCalledTimes(1);
    });

    it('seeks via the scrubber, showing the sought tick from the buffer', async () => {
        const bridge = makeBridge();
        installReplayBridge(bridge);

        render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');

        const { fireEvent } = await import('@testing-library/react');
        fireEvent.change(screen.getByRole('slider'), { target: { value: '4' } });

        await waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '4');
        });
    });

    it('seeking beyond the buffered range fetches a fresh range', async () => {
        const bridge = makeBridge({
            openPlayback: vi.fn(() =>
                Promise.resolve({ ...INFO, totalTicks: 100 } satisfies ReplayPlaybackInfo),
            ),
        });
        installReplayBridge(bridge);

        render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');

        const { fireEvent } = await import('@testing-library/react');
        fireEvent.change(screen.getByRole('slider'), { target: { value: '80' } });

        await waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '80');
        });
        // A new range anchored at the sought tick, not covered by the tick-0 batch.
        expect(bridge.snapshotRange).toHaveBeenCalledWith(80, expect.any(Number));
    });

    it('toggles play and pause', async () => {
        installReplayBridge(makeBridge());

        render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');

        await userEvent.click(screen.getByRole('button', { name: /play/i }));
        expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /pause/i }));
        expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    });

    it('auto-advances ticks while playing then stops at the end', async () => {
        vi.useFakeTimers();
        installReplayBridge(makeBridge());

        render(<ReplayPlayerPage />);
        // Let the initial async openPlayback + snapshotAt settle.
        await vi.waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '0');
        });

        await act(async () => {
            screen.getByRole('button', { name: /play/i }).click();
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        await vi.waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '5');
        });
        // Reaching the end pauses automatically.
        expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    });

    it('auto-advances faster at 2x speed', async () => {
        vi.useFakeTimers();
        installReplayBridge(makeBridge());

        render(<ReplayPlayerPage />);
        await vi.waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '0');
        });

        await act(async () => {
            const { fireEvent } = await import('@testing-library/react');
            fireEvent.change(screen.getByRole('combobox', { name: /speed/i }), {
                target: { value: '2' },
            });
        });
        await act(async () => {
            screen.getByRole('button', { name: /play/i }).click();
        });

        // At 2x (500ms/tick) 2500ms is enough to reach the final tick 5;
        // at 1x it would only reach tick 2.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2500);
        });

        await vi.waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '5');
        });
    });

    it('shows an error state when openPlayback fails', async () => {
        installReplayBridge(
            makeBridge({ openPlayback: vi.fn(() => Promise.reject(new Error('bad file'))) }),
        );

        render(<ReplayPlayerPage />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
    });

    it('closes playback on unmount', async () => {
        const bridge = makeBridge();
        installReplayBridge(bridge);

        const { unmount } = render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');
        unmount();

        expect(bridge.closePlayback).toHaveBeenCalled();
    });
});
