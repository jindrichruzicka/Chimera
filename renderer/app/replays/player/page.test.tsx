// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render as baseRender, screen, waitFor } from '@testing-library/react';
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
// apps/* screen modules under test. Routed through a hoisted mock so a case can
// hand the route a game that declares a manifest.
const loadRendererGameMock = vi.hoisted(() => vi.fn());
vi.mock('../../../game/rendererGameRegistry', () => ({
    loadRendererGame: loadRendererGameMock,
}));

// The manager the route builds and injects. Mocked at its source so a case owns
// whether the critical preload ever settles; without that the gate's pending
// window is not observable.
const assetManagerFor = vi.hoisted(() => vi.fn());
vi.mock('../../gameAssetSession.js', () => ({
    useRendererGameAssetManager: (loadedGame: unknown) => assetManagerFor(loadedGame),
}));

// Stub GameShell — we assert which snapshot AND content it receives, not how it
// draws. The game-specific playfield derives its colour palette from `content`, so a
// replay that omits it renders every unit in the default colour.
vi.mock('../../../components/shell/GameShell', () => ({
    GameShell: ({
        snapshot,
        content,
        leaveGame,
        assetManager,
        sceneCoverOccluded,
        hudMounted,
        revealPhase,
        onScenePending,
    }: {
        snapshot?: PlayerSnapshot;
        content?: GameContent;
        leaveGame?: () => void;
        assetManager?: { dispose(): void };
        sceneCoverOccluded?: boolean;
        hudMounted?: boolean;
        revealPhase?: string;
        onScenePending?: (pending: boolean) => void;
    }) => {
        // Mirrors Invariant #21 in the double: GameShell is the unique disposer
        // of the manager its host route injects, and the route disposes nothing.
        // Without this the unmount case could not tell "disposed once" from
        // "never disposed at all".
        React.useEffect(() => () => assetManager?.dispose(), [assetManager]);
        // Drives the route's chunk-pending term. No dep array: the value lives
        // in a module variable a case reassigns, which React cannot see.
        React.useEffect(() => {
            if (mockScenePending !== null) {
                onScenePending?.(mockScenePending);
            }
        });
        return (
            <div
                data-testid="game-shell"
                data-tick={snapshot?.tick ?? 'none'}
                data-content={content === undefined ? 'none' : JSON.stringify(content)}
                data-scene-cover-occluded={String(sceneCoverOccluded)}
                data-hud-mounted={String(hudMounted)}
                data-reveal-phase={String(revealPhase)}
            >
                {/* Surfaces the in-game-menu leave so the player's `handleLeaveReplay`
                    navigation can be exercised without the real shell UI. */}
                <button type="button" data-testid="shell-leave-btn" onClick={() => leaveGame?.()}>
                    leave
                </button>
            </div>
        );
    },
}));

// The page reads `?path=`/`?kind=` via `useSearchParams`; back it with the URL
// each test sets through `window.history.replaceState`. `useRouter` backs the
// in-game-menu leave navigation (library replays push back to the library).
const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(window.location.search),
    useRouter: () => ({ push: mockRouterPush }),
}));

import { I18nProvider } from '../../../i18n/I18nProvider';
import { EscapeStackProvider } from '../../../components/shell/EscapeStack';
import { SCREEN_FADE_FAST_MS } from '../../../components/shell/screenFadeDuration';
import { useGameStore } from '../../../state/gameStore';
import { useUiStore } from '../../../state/uiStore';
import { resetGameContentCache } from '../../../state/useGameContent';
import ReplayPlayerPage from './page';

// The player and its ReplayControls render user-facing strings through
// `useTranslate()`, which throws outside an I18nProvider; wrap every render. The
// save affordance's name dialog (a shared Modal) also needs an EscapeStackProvider
// (useEscapeLayer throws otherwise).
function render(
    ui: React.ReactElement,
    gameOverride?: Record<string, string>,
): ReturnType<typeof baseRender> {
    return baseRender(
        <I18nProvider {...(gameOverride === undefined ? {} : { gameOverride })}>
            <EscapeStackProvider>{ui}</EscapeStackProvider>
        </I18nProvider>,
    );
}

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

/**
 * A manager double whose critical preload settles only when a case says so.
 *
 * The route hands one of these to `GameShell` and never disposes it, so the
 * double records `dispose` for the shell double to call.
 */
interface ManagerDouble {
    readonly assetManager: { dispose(): void };
    readonly dispose: ReturnType<typeof vi.fn>;
    /**
     * Resolve the preload the moment it starts.
     *
     * The warm-hardware case the beat exists for: the load is done before
     * anything could have been shown, so a beat armed on the wait still being
     * live would show nothing at all.
     */
    settleOnCall: boolean;
    settle(): void;
}

function createManagerDouble(): ManagerDouble {
    let resolvePreload: (() => void) | undefined;
    const dispose = vi.fn();
    const double: ManagerDouble = {
        assetManager: {
            registerManifest: vi.fn(),
            preloadCritical: vi.fn(() => {
                if (double.settleOnCall) {
                    return Promise.resolve();
                }
                return new Promise<void>((resolve) => {
                    resolvePreload = resolve;
                });
            }),
            get: () => null,
            load: () => Promise.reject(new Error('not used')),
            getManifestMetadata: () => undefined,
            dispose,
        } as unknown as { dispose(): void },
        dispose,
        settleOnCall: false,
        settle: () => resolvePreload?.(),
    };
    return double;
}

const CRITICAL_MANIFEST = {
    gameId: 'tactics',
    entries: [{ ref: 'tactics/textures/board.webp', kind: 'texture', priority: 'critical' }],
};

/**
 * Set by a case that wants the mocked shell to report a suspending screen.
 * The real SceneRouter reports this; the mock cannot without a way to drive it.
 */
let mockScenePending: boolean | null = null;

/** One double per test: the gate keys on manager IDENTITY, so it must be stable. */
let managerDouble: ReturnType<typeof createManagerDouble>;

beforeEach(() => {
    mockRouterPush.mockClear();
    window.history.replaceState({}, '', `/replays/player?path=${encodeURIComponent(PATH)}`);
    loadRendererGameMock.mockReset();
    loadRendererGameMock.mockResolvedValue({ registry: { screens: {} } });
    managerDouble = createManagerDouble();
    mockScenePending = null;
    assetManagerFor.mockReset();
    assetManagerFor.mockImplementation((loadedGame: unknown) =>
        loadedGame === null ? null : managerDouble.assetManager,
    );
});

afterEach(() => {
    cleanup();
    // The game store is a module singleton, so a lobby snapshot set by one
    // case would suppress the beat in every case after it.
    useGameStore.getState().reset();
    Reflect.deleteProperty(window, '__chimera');
    resetGameContentCache();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

describe('ReplayPlayerPage', () => {
    it('renders the loading status text from the engine.replays.playerLoading token', () => {
        // Keep the bridge pending so the player stays on its loading status, whose
        // copy must come from the token (proving it is not a hardcoded literal).
        installReplayBridge(
            makeBridge({ openPlayback: vi.fn(() => new Promise<never>(() => {})) }),
        );

        render(<ReplayPlayerPage />, { 'engine.replays.playerLoading': 'Buffering…' });

        expect(screen.getByText('Buffering…')).toBeInTheDocument();
    });

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

    it('hands the replay game content to GameShell so the playfield can resolve colours', async () => {
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

    it('renders the playback controls above the playfield', async () => {
        installReplayBridge(makeBridge());

        render(<ReplayPlayerPage />);
        const playfield = await screen.findByTestId('game-shell');
        const controls = screen.getByRole('group', { name: /replay playback controls/i });

        // Controls sit at the top of the player, so they precede the playfield in the
        // DOM (keeping focus/reading order aligned with the visual order).
        expect(
            controls.compareDocumentPosition(playfield) & Node.DOCUMENT_POSITION_FOLLOWING,
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

    it('resets a stale post-game summary screen to the playfield on entry', async () => {
        // Opening a replay from the in-game post-game summary carries the
        // module-level uiStore's stale 'summary' screen into the player, which
        // would render the summary (and its invalid Replay button) over the first
        // recorded frame. The player must reset to the playfield on entry.
        useUiStore.getState().navigateToScreen('summary');
        expect(useUiStore.getState().activeScreenKey).toBe('summary');

        installReplayBridge(makeBridge());
        render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');

        expect(useUiStore.getState().activeScreenKey).toBe('playfield');
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

        it('names and saves the current match and disables the icon (deterministic)', async () => {
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

            // Clicking opens the name dialog; typing + confirming persists the name.
            await userEvent.click(save);
            await userEvent.type(screen.getByTestId('replay-save-name-input'), 'Grand Finale');
            await userEvent.click(screen.getByTestId('replay-save-name-confirm'));

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /replay saved/i })).toBeDisabled();
            });
            expect(exportCurrentMatch).toHaveBeenCalledWith('save', 'Grand Finale');
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

            // Open the name dialog, enter a name, and confirm.
            await userEvent.click(screen.getByTestId('replay-save-btn'));
            await userEvent.type(screen.getByTestId('replay-save-name-input'), 'Client POV');
            await userEvent.click(screen.getByTestId('replay-save-name-confirm'));

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /replay saved/i })).toBeDisabled();
            });
            // The deterministic replay stays host-only (Invariants #71 / #98).
            expect(exportCurrent).toHaveBeenCalledTimes(1);
            expect(exportCurrent).toHaveBeenCalledWith('Client POV');
            expect(exportCurrentMatch).not.toHaveBeenCalled();
        });
    });
});

describe('ReplayPlayerPage asset reveal gate', () => {
    it('shows the loading cover OVER the mounted shell, not instead of it', async () => {
        loadRendererGameMock.mockResolvedValue({
            registry: { screens: {}, loadingScreen: 'spinner' },
            assetManifest: CRITICAL_MANIFEST,
        });
        installReplayBridge(makeBridge());

        render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');

        // Both, at once. Withholding <GameShell> here would orphan the manager
        // `useRendererGameAssetManager` allocated and never disposes — exactly
        // the leak Invariant #21 exists to prevent.
        //
        // Awaited rather than read: the shell lands on the commit that makes
        // the route ready, while the beat reaches its cover a few commits
        // later, having walked its own phases first.
        expect(await screen.findByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(screen.getByTestId('game-shell')).toBeInTheDocument();
    });

    it('leaves its own loading state even while the critical load never resolves', async () => {
        loadRendererGameMock.mockResolvedValue({
            registry: { screens: {} },
            assetManifest: CRITICAL_MANIFEST,
        });
        installReplayBridge(makeBridge());

        render(<ReplayPlayerPage />, { 'engine.replays.playerLoading': 'Buffering…' });
        await screen.findByTestId('game-shell');

        // `isReady` is deliberately NOT gated on the preload: the transport
        // controls and the shell belong to the route, and a route that waited
        // here would never build the manager the preload needs.
        expect(screen.queryByText('Buffering…')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /step forward/i })).toBeInTheDocument();
    });

    it('disposes the injected manager exactly once when unmounted mid-preload', async () => {
        loadRendererGameMock.mockResolvedValue({
            registry: { screens: {} },
            assetManifest: CRITICAL_MANIFEST,
        });
        installReplayBridge(makeBridge());

        const view = render(<ReplayPlayerPage />);
        await screen.findByTestId('game-shell');
        expect(managerDouble.dispose).not.toHaveBeenCalled();

        view.unmount();

        // One manager, one disposal: the gate must not have made the route swap
        // managers mid-flight, and its own teardown must not add a second owner.
        expect(managerDouble.dispose).toHaveBeenCalledTimes(1);
    });
});

describe('ReplayPlayerPage loading beat', () => {
    const REPLAY_FLOOR_MS = 400;

    function installBeatGame(registry: Record<string, unknown>): void {
        loadRendererGameMock.mockResolvedValue({
            registry,
            assetManifest: CRITICAL_MANIFEST,
        });
    }

    /**
     * The beat cases run under fake timers — `performance` faked so the floor's
     * monotonic stamp advances with them, and `requestAnimationFrame` because
     * the cover's rise rides a frame — where `waitFor` cannot poll, so the
     * mount flush is an explicit advance.
     */
    async function mountUnderFakeTimers(): Promise<void> {
        render(<ReplayPlayerPage />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(20);
        });
        expect(screen.getByTestId('game-shell')).toBeInTheDocument();
    }

    /** Advance in steps, so each leg's timer is armed by the render before it. */
    async function step(ms: number): Promise<void> {
        for (let elapsed = 0; elapsed < ms; elapsed += 20) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(Math.min(20, ms - elapsed));
            });
        }
    }

    const shellAttr = (name: string): string | null =>
        screen.getByTestId('game-shell').getAttribute(name);

    beforeEach(() => {
        vi.useFakeTimers({
            toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame'],
        });
        installReplayBridge(makeBridge());
    });

    it('shows the cover even when the preload settles before the first frame', async () => {
        // The case a visibility-armed hold could not serve. This route has no
        // entry fade of its own, so the old shape stamped at cover mount and
        // did reach it — but only because nothing was ever painted over the
        // cover here. The beat reaches it for the same reason on both routes.
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();

        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(shellAttr('data-hud-mounted')).toBe('false');
    });

    it('holds the cover for the declared floor, then reveals', async () => {
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();

        await step(SCREEN_FADE_FAST_MS + REPLAY_FLOOR_MS - 40);
        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();

        await step(SCREEN_FADE_FAST_MS * 2 + 120);
        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(shellAttr('data-hud-mounted')).toBe('true');
        // The transport controls are part of the reveal, and they are back:
        // `isReady` is never widened by the beat.
        expect(screen.getByRole('button', { name: /step forward/i })).toBeInTheDocument();
    });

    it('collapses every leg under NEXT_PUBLIC_CHIMERA_E2E', async () => {
        // Pinned at THIS use site: the resolvers' own unit tests cannot fail
        // for a route that stops calling them.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(shellAttr('data-hud-mounted')).toBe('true');
    });

    it('mounts no cover for a game that declares none', async () => {
        installBeatGame({ screens: {} });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
    });

    it('mounts no cover for the per-key none opt-out', async () => {
        installBeatGame({ screens: {}, loadingScreens: { playfield: 'none' } });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
    });

    it('reports occlusion to the shell until the reveal', async () => {
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();
        expect(shellAttr('data-scene-cover-occluded')).toBe('true');

        await step(SCREEN_FADE_FAST_MS * 3 + REPLAY_FLOOR_MS + 120);

        expect(shellAttr('data-scene-cover-occluded')).toBe('false');
    });

    it('covers a game whose gate settles in render, with no wait to condition on', async () => {
        // A manifest-less game: the gate short-circuits in RENDER, so the wait
        // is over before the beat's first commit. A beat that armed on the wait
        // still being live would show nothing here — this is the warm case with
        // the race taken out of it.
        loadRendererGameMock.mockResolvedValue({
            registry: {
                screens: {},
                loadingScreen: 'spinner',
                loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
            },
        });
        await mountUnderFakeTimers();

        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(shellAttr('data-hud-mounted')).toBe('false');
    });

    it('ramps its cover down before dropping it, rather than cutting it out', async () => {
        // The page has to hand the cover the beat's LIVE visibility. A constant
        // leaves it opaque until unmount, which is the cut this sequence
        // replaces — the replay would appear with no black between.
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();
        const cover = (): HTMLElement => screen.getByTestId('route-entry-loading-cover');

        await step(SCREEN_FADE_FAST_MS + 60);
        expect(cover().style.opacity).toBe('1');

        await step(REPLAY_FLOOR_MS + 40);
        expect(cover().style.opacity).toBe('0');
    });

    it('withholds the reveal while the entering screen chunk is still in flight', async () => {
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        managerDouble.settleOnCall = true;
        mockScenePending = true;
        await mountUnderFakeTimers();

        await step(SCREEN_FADE_FAST_MS * 3 + REPLAY_FLOOR_MS + 120);

        expect(shellAttr('data-hud-mounted')).toBe('false');
    });

    it('stops the beat when a leave takes the screen', async () => {
        // The hazard this route's old comment described: a fade issued here can
        // cancel the fade-out GameStoreBootstrap runs on a replay's Leave, and a
        // cancelled fade resolves early, landing the navigation mid-ramp. The
        // beat stops issuing anything once the leave latches.
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        await mountUnderFakeTimers();

        await act(async () => {
            screen.getByTestId('shell-leave-btn').click();
            await Promise.resolve();
        });
        managerDouble.settleOnCall = true;
        await act(async () => {
            managerDouble.settle();
            await Promise.resolve();
        });
        await step(SCREEN_FADE_FAST_MS * 3 + REPLAY_FLOOR_MS + 120);

        expect(shellAttr('data-hud-mounted')).toBe('false');
    });

    it('stops the beat on the post-game leave, the branch that owns a live session', async () => {
        // The `?saveable=1` branch is the ONLY one whose leave makes
        // GameStoreBootstrap run a fade-out at all — the other is a bare
        // router.push. Latching after that branch returns would leave the beat
        // running against exactly the exit the latch exists for.
        window.history.replaceState(
            {},
            '',
            `/replays/player?path=${encodeURIComponent(PATH)}&saveable=1`,
        );
        // This branch routes through the real `useLeaveGame`, which throws
        // without a lobby bridge — the leave has to actually run for the latch's
        // position relative to it to mean anything.
        Object.defineProperty(window, '__chimera', {
            configurable: true,
            value: {
                replay: makeBridge(),
                lobby: {
                    leave: vi.fn(async () => undefined),
                    returnToLobby: vi.fn(async () => undefined),
                },
            },
        });
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        await mountUnderFakeTimers();

        await act(async () => {
            screen.getByTestId('shell-leave-btn').click();
            await Promise.resolve();
        });
        managerDouble.settleOnCall = true;
        await act(async () => {
            managerDouble.settle();
            await Promise.resolve();
        });
        await step(SCREEN_FADE_FAST_MS * 3 + REPLAY_FLOOR_MS + 120);

        expect(shellAttr('data-hud-mounted')).toBe('false');
    });

    it('stops the beat when a lobby snapshot arrives without anything here being clicked', async () => {
        // A host's Leave from a post-game replay broadcasts phase:'lobby', and
        // GameStoreBootstrap answers it on THIS route with a fade-out whose
        // promise its navigation is chained to. Nothing on this page is
        // clicked, so the leave latch cannot see it — a beat that faded in
        // here would cancel that fade-out, and a cancelled fade resolves
        // early, landing the navigation mid-ramp.
        useGameStore.getState().applySnapshot({
            tick: 0,
            phase: 'lobby',
            viewerId: 'p1',
            players: {},
            undoMeta: { canUndo: false, canRedo: false },
        } as unknown as PlayerSnapshot);
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();

        await step(SCREEN_FADE_FAST_MS * 3 + REPLAY_FLOOR_MS + 120);

        expect(shellAttr('data-hud-mounted')).toBe('false');
    });

    it('carries the default floor for a cover declared without a minimum', async () => {
        // The axis that separates this route's resolver from the hold it
        // replaced: an ABSENT declaration is a default-length beat here, not no
        // beat at all. Every other fixture in this describe declares a minimum,
        // so without this the two resolvers are indistinguishable at this site.
        installBeatGame({ screens: {}, loadingScreen: 'spinner' });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();

        // Read the cover's OPACITY, not its presence: it stays mounted through
        // the closing leg, so a zero floor is still on screen at this instant
        // and a presence check cannot tell the two resolvers apart. Held at
        // full opacity is what only a floor still running produces.
        await step(SCREEN_FADE_FAST_MS + 60);
        expect(screen.getByTestId('route-entry-loading-cover').style.opacity).toBe('1');
    });

    it('gives its cover a real ramp, not a cut', async () => {
        // The duration reaches the cover from this call site. With it zeroed
        // the cover mounts already opaque and carries no transition — which is
        // what the e2e build and reduced motion get deliberately, and what a
        // normal entry must not.
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        managerDouble.settleOnCall = true;
        await mountUnderFakeTimers();

        expect(screen.getByTestId('route-entry-loading-cover').style.transition).toContain(
            `opacity ${SCREEN_FADE_FAST_MS}ms`,
        );
    });

    it('withholds the reveal while the preload is still running', async () => {
        // The beat defers; it does not manufacture a reveal. Without the gate
        // settling, no timer of the beat's releases it.
        installBeatGame({
            screens: {},
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: REPLAY_FLOOR_MS,
        });
        await mountUnderFakeTimers();

        await step(REPLAY_FLOOR_MS * 4);

        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(shellAttr('data-hud-mounted')).toBe('false');
    });
});
