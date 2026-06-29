// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    GameContent,
    PerspectiveReplayPlaybackInfo,
    PlayerSnapshot,
    ReplayAPI,
    ReplayPlaybackInfo,
} from '@chimera-engine/simulation/bridge/api-types.js';

// Stub the game renderer loader so the player page does not pull in real
// games/* screen modules under test.
vi.mock('../../../game/rendererGameRegistry', () => ({
    loadRendererGame: vi.fn(() => Promise.resolve({ registry: { screens: {} } })),
}));

// Stub GameShell — we assert which snapshot AND content it receives, not how it
// draws. The game-specific board derives its colour palette from `content`, so a
// replay that omits it renders every unit in the default colour.
vi.mock('../../../components/shell/GameShell', () => ({
    GameShell: ({
        snapshot,
        content,
        leaveGame,
    }: {
        snapshot?: PlayerSnapshot;
        content?: GameContent;
        leaveGame?: () => void;
    }) => (
        <div
            data-testid="game-shell"
            data-tick={snapshot?.tick ?? 'none'}
            data-content={content === undefined ? 'none' : JSON.stringify(content)}
        >
            {/* Surfaces the in-game-menu leave so the player's `handleLeaveReplay`
                navigation can be exercised without the real shell UI. */}
            <button type="button" data-testid="shell-leave-btn" onClick={() => leaveGame?.()}>
                leave
            </button>
        </div>
    ),
}));

// The page reads `?path=`/`?kind=` via `useSearchParams`; back it with the URL
// each test sets through `window.history.replaceState`. `useRouter` backs the
// in-game-menu leave navigation (library replays push back to the library).
const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(window.location.search),
    useRouter: () => ({ push: mockRouterPush }),
}));

import { useUiStore } from '../../../state/uiStore';
import { resetGameContentCache } from '../../../state/useGameContent';
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
    mockRouterPush.mockClear();
    window.history.replaceState({}, '', `/replays/player?path=${encodeURIComponent(PATH)}`);
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    resetGameContentCache();
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

    it('hands the replay game content to GameShell so the board can resolve colours', async () => {
        // Without content the tactics board palette is empty and every unit falls
        // back to the default colour (all-blue). The player must fetch the replay
        // game's content (keyed by `info.gameId`) and pass it through, exactly as
        // the live game route does.
        const tacticsContent = {
            player: [{ id: 'red' }, { id: 'blue' }],
        } as unknown as GameContent;
        const getCollections = vi.fn(() => Promise.resolve(tacticsContent));
        Object.defineProperty(window, '__chimera', {
            configurable: true,
            value: { replay: makeBridge(), content: { getCollections } },
        });

        render(<ReplayPlayerPage />);

        await waitFor(() => {
            expect(screen.getByTestId('game-shell')).toHaveAttribute(
                'data-content',
                JSON.stringify(tacticsContent),
            );
        });
        // Fetched for the replay's own game, not hard-coded.
        expect(getCollections).toHaveBeenCalledWith(INFO.gameId);
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

    it('renders the playback controls above the board', async () => {
        installReplayBridge(makeBridge());

        render(<ReplayPlayerPage />);
        const board = await screen.findByTestId('game-shell');
        const controls = screen.getByRole('group', { name: /replay playback controls/i });

        // Controls sit at the top of the player, so they precede the board in the
        // DOM (keeping focus/reading order aligned with the visual order).
        expect(
            controls.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
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

    it('resets a stale post-game summary screen to the board on entry', async () => {
        // Opening a replay from the in-game post-game summary carries the
        // module-level uiStore's stale 'summary' screen into the player, which
        // would render the summary (and its invalid Replay button) over the first
        // recorded frame. The player must reset to the board on entry.
        useUiStore.getState().navigateToScreen('summary');
        expect(useUiStore.getState().activeScreenKey).toBe('summary');

        installReplayBridge(makeBridge());
        render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');

        expect(useUiStore.getState().activeScreenKey).toBe('board');
    });

    describe('leaving a library-opened replay', () => {
        it('returns to the library carrying the shell gameId from the URL, not the recorded one', async () => {
            // A library replay has no live session, so Leave routes back to the
            // library. The shell (incl. the main-menu override) resolves only from
            // the `?gameId=` shell context, so the hop must carry THE URL's gameId —
            // not the replay's own recorded gameId — or closing the library lands on
            // the engine-default menu. URL and recorded id differ here to lock that.
            window.history.replaceState(
                {},
                '',
                `/replays/player?path=${encodeURIComponent(PATH)}&gameId=tactics`,
            );
            installReplayBridge(
                makeBridge({
                    openPlayback: vi.fn(() =>
                        Promise.resolve({ ...INFO, gameId: 'some-other-game' }),
                    ),
                }),
            );

            render(<ReplayPlayerPage />);
            await screen.findByTestId('game-shell');

            await userEvent.click(screen.getByTestId('shell-leave-btn'));

            await waitFor(() => {
                expect(mockRouterPush).toHaveBeenCalledWith('/replays?gameId=tactics');
            });
        });
    });

    describe('save affordance (?saveable=1)', () => {
        it('renders no save icon for a library-opened replay (no saveable flag)', async () => {
            installReplayBridge(makeBridge());

            render(<ReplayPlayerPage />);
            await screen.findByTestId('game-shell');

            expect(screen.queryByTestId('replay-save-btn')).toBeNull();
        });

        it('saves the current match and disables the icon (deterministic)', async () => {
            window.history.replaceState(
                {},
                '',
                `/replays/player?path=${encodeURIComponent(PATH)}&saveable=1`,
            );
            const exportCurrentMatch = vi.fn(() => Promise.resolve(PATH));
            installReplayBridge(makeBridge({ exportCurrentMatch }));

            render(<ReplayPlayerPage />);
            await screen.findByTestId('game-shell');

            const save = screen.getByTestId('replay-save-btn');
            expect(save).toBeEnabled();

            await userEvent.click(save);

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /replay saved/i })).toBeDisabled();
            });
            expect(exportCurrentMatch).toHaveBeenCalledWith('save');
        });
    });

    describe('perspective replays (?kind=perspective)', () => {
        const PERSPECTIVE_INFO: PerspectiveReplayPlaybackInfo = {
            gameId: 'tactics',
            totalTicks: 5,
            viewerId: 'p1',
        };

        // The perspective playback API serves verbatim, sparsely-recorded frames
        // (T7). `snapshotAt` does a floor lookup on main — here ticks 0 and 3 are
        // recorded, so requesting tick 4 yields the frame stored at tick 3.
        const RECORDED_TICKS = [0, 3];

        interface PerspectiveBridge {
            readonly openPlayback: ReturnType<typeof vi.fn>;
            readonly snapshotAt: ReturnType<typeof vi.fn>;
            readonly closePlayback: ReturnType<typeof vi.fn>;
        }

        function installPerspectiveBridge(): {
            perspective: PerspectiveBridge;
            deterministicOpenPlayback: ReturnType<typeof vi.fn>;
        } {
            const snapshotAt = vi.fn((tick: number) => {
                const floor = Math.max(...RECORDED_TICKS.filter((t) => t <= tick));
                return Promise.resolve(snapshotAtTick(floor));
            });
            const perspective: PerspectiveBridge = {
                openPlayback: vi.fn(() => Promise.resolve(PERSPECTIVE_INFO)),
                snapshotAt,
                closePlayback: vi.fn(() => Promise.resolve()),
            };
            const deterministicOpenPlayback = vi.fn(() => Promise.resolve(INFO));
            Object.defineProperty(window, '__chimera', {
                configurable: true,
                value: { replay: { openPlayback: deterministicOpenPlayback, perspective } },
            });
            return { perspective, deterministicOpenPlayback };
        }

        beforeEach(() => {
            window.history.replaceState(
                {},
                '',
                `/replays/player?path=${encodeURIComponent(PATH)}&kind=perspective`,
            );
        });

        it('opens the perspective playback session, not the deterministic one', async () => {
            const { perspective, deterministicOpenPlayback } = installPerspectiveBridge();

            render(<ReplayPlayerPage />);

            await waitFor(() => {
                expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '0');
            });
            expect(perspective.openPlayback).toHaveBeenCalledWith(PATH);
            expect(deterministicOpenPlayback).not.toHaveBeenCalled();
            expect(perspective.snapshotAt).toHaveBeenCalledWith(0);
        });

        it('shows the floor frame from snapshotAt when seeking to a non-recorded tick', async () => {
            const { perspective } = installPerspectiveBridge();

            render(<ReplayPlayerPage />);
            await screen.findByTestId('game-shell');

            const { fireEvent } = await import('@testing-library/react');
            fireEvent.change(screen.getByRole('slider'), { target: { value: '4' } });

            await waitFor(() => {
                expect(screen.getByTestId('game-shell')).toHaveAttribute('data-tick', '3');
            });
            expect(perspective.snapshotAt).toHaveBeenCalledWith(4);
        });

        it('renders no seat switcher and labels the controls for perspective', async () => {
            installPerspectiveBridge();

            render(<ReplayPlayerPage />);
            await screen.findByTestId('game-shell');

            expect(screen.queryByRole('combobox', { name: /seat|viewer/i })).toBeNull();
            expect(
                screen.getByRole('group', { name: /perspective replay playback controls/i }),
            ).toBeInTheDocument();
        });

        it('closes the perspective playback on unmount', async () => {
            const { perspective } = installPerspectiveBridge();

            const { unmount } = render(<ReplayPlayerPage />);
            await screen.findByTestId('game-shell');
            unmount();

            expect(perspective.closePlayback).toHaveBeenCalled();
        });

        it('saves via perspective.exportCurrent when saveable, never the deterministic export', async () => {
            window.history.replaceState(
                {},
                '',
                `/replays/player?path=${encodeURIComponent(PATH)}&kind=perspective&saveable=1`,
            );
            const exportCurrent = vi.fn(() => Promise.resolve(PATH));
            const exportCurrentMatch = vi.fn(() => Promise.resolve(PATH));
            Object.defineProperty(window, '__chimera', {
                configurable: true,
                value: {
                    replay: {
                        openPlayback: vi.fn(() => Promise.resolve(INFO)),
                        exportCurrentMatch,
                        perspective: {
                            openPlayback: vi.fn(() => Promise.resolve(PERSPECTIVE_INFO)),
                            snapshotAt: vi.fn(() => Promise.resolve(snapshotAtTick(0))),
                            closePlayback: vi.fn(() => Promise.resolve()),
                            exportCurrent,
                        },
                    },
                },
            });

            render(<ReplayPlayerPage />);
            await screen.findByTestId('game-shell');

            await userEvent.click(screen.getByTestId('replay-save-btn'));

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /replay saved/i })).toBeDisabled();
            });
            // The deterministic replay stays host-only (Invariants #71 / #98).
            expect(exportCurrent).toHaveBeenCalledTimes(1);
            expect(exportCurrentMatch).not.toHaveBeenCalled();
        });
    });
});
