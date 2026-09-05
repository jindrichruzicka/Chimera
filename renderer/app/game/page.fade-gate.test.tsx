// @vitest-environment jsdom
// renderer/app/game/page.fade-gate.test.tsx
//
// The route's REVEAL gate: which of the app-level fade-in, the route-entry
// cover, and the escape hatches around them fire while the critical asset
// preload is still running.
//
// Its own file rather than more cases in `page.test.tsx`, which is 36 kB and
// mocks `GameShell` without an asset manager at all: the gate is about the
// manager, so this file mocks `useRendererGameAssetManager` with one whose
// `preloadCritical` each case settles by hand. `page.test.tsx` and
// `page.asset-manager.test.tsx` stay UNMODIFIED — they are the sentinel that
// this gate did not become a mount gate.
//
// Tests written first — confirmed RED before the gate was wired into page.tsx.

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type LobbyState,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import { buildAssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManager } from '../../assets/AssetManager';
import { CRITICAL_ASSET_PRELOAD_BUDGET_MS } from '../../assets/criticalAssetPreload.js';
import { FadeContext, type FadeControl } from '../../components/shell/FadeContext';
import { SCREEN_FADE_FAST_MS } from '../../components/shell/screenFadeDuration';
import { I18nProvider } from '../../i18n/I18nProvider';
import { useUiStore } from '../../state/uiStore';
import GamePage from './page';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const CRITICAL_REF: AssetRef<TextureAsset> = buildAssetRef<TextureAsset>('demo', 'textures/a.webp');
const DEFERRED_REF: AssetRef<TextureAsset> = buildAssetRef<TextureAsset>('demo', 'textures/b.webp');

const mockReplace = vi.fn();
const mockReset = vi.fn();
const mockSetLeavingToMainMenu = vi.fn();
const mockClearRestoreAbort = vi.fn();
let mockSnapshot: PlayerSnapshot | null = null;
let mockLobbyState: LobbyState | null = null;
let mockLeavingToMainMenu = false;
let mockRestoreAbortPending = false;
let mockRestore: { readonly state: string } | null = null;
const loadRendererGameMock = vi.hoisted(() => vi.fn());
const assetManagerFor = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('../../state/saveStore', () => ({
    useSaveStore: Object.assign(
        (
            selector: (state: {
                readonly restoreAbortPending: boolean;
                readonly restore: { readonly state: string } | null;
            }) => unknown,
        ) => selector({ restoreAbortPending: mockRestoreAbortPending, restore: mockRestore }),
        { getState: () => ({ clearRestoreAbort: mockClearRestoreAbort }) },
    ),
}));

vi.mock('../../state/gameStore', () => ({
    useGameStore: Object.assign(
        (
            selector: (state: {
                readonly snapshot: PlayerSnapshot | null;
                readonly currentTick: number | undefined;
                readonly lastReveal: null;
            }) => unknown,
        ) => selector({ snapshot: mockSnapshot, currentTick: undefined, lastReveal: null }),
        { getState: () => ({ reset: mockReset }) },
    ),
}));

vi.mock('../../state/lobbyUiStore', () => ({
    useLobbyUiStore: Object.assign(
        (selector: (state: { readonly leavingToMainMenu: boolean }) => unknown) =>
            selector({ leavingToMainMenu: mockLeavingToMainMenu }),
        { getState: () => ({ setLeavingToMainMenu: mockSetLeavingToMainMenu }) },
    ),
    useIsSpectator: () => false,
}));

vi.mock('../../state/lobbyStore', () => ({
    useLobbyStore: (
        selector: (state: {
            readonly lobbyState: LobbyState | null;
            readonly hasLoadedInitialState: boolean;
        }) => unknown,
    ) => selector({ lobbyState: mockLobbyState, hasLoadedInitialState: true }),
}));

vi.mock('../../bridge/useSendAction', () => ({ useSendAction: () => vi.fn() }));

vi.mock('../../game/rendererGameRegistry', () => ({ loadRendererGame: loadRendererGameMock }));

vi.mock('../../input/useInputAction.js', () => ({ useInputAction: () => undefined }));

// The manager the route hands to GameShell. Mocked at its source so each case
// owns when the preload settles; the gate under test is the REAL one.
vi.mock('../gameAssetSession.js', () => ({
    useRendererGameAssetManager: (loadedGame: unknown) => assetManagerFor(loadedGame),
}));

/**
 * Set by a case that wants the mocked shell to report a suspending screen.
 *
 * The real `SceneRouter` reports this; the mock cannot, so without a way to
 * drive it the `!scenePending` half of the route's settle term is never false
 * in any case and can be deleted with the suite green.
 */
let mockScenePending: boolean | null = null;

vi.mock('../../components/shell/GameShell', async () => {
    const react = await import('react');
    return {
        GameShell: (props: {
            sceneCoverOccluded?: boolean;
            hudMounted?: boolean;
            menuMounted?: boolean;
            revealPhase?: string;
            onScenePending?: (pending: boolean) => void;
        }) => {
            const { onScenePending } = props;
            // No dep array: the value it reports lives in a module variable a
            // case reassigns, which React cannot see. Reporting on every render
            // is what lets a case flip it; the route's own `setScenePending`
            // makes a repeat of the same value a no-op.
            react.useEffect(() => {
                if (mockScenePending !== null) {
                    onScenePending?.(mockScenePending);
                }
            });
            return react.createElement('div', {
                'data-testid': 'mock-game-shell',
                'data-scene-cover-occluded': String(props.sceneCoverOccluded),
                // The two seams the beat drives, and they part company on
                // purpose. `menuMounted` is the route's REVEAL — exposed here
                // because a game that declares no cover mounts none, so it is
                // the only thing that says whether the route has revealed.
                // `hudMounted` is earlier: the layout-bearing row, mounted
                // while the screen is still opaque so the canvas re-fit it
                // causes lands under black rather than inside the fade.
                'data-menu-mounted': String(props.menuMounted),
                'data-hud-mounted': String(props.hudMounted),
                'data-reveal-phase': String(props.revealPhase),
            });
        },
    };
});

// ── Harness ────────────────────────────────────────────────────────────────────

interface PreloadHarness {
    readonly assetManager: AssetManager;
    readonly preloadCritical: ReturnType<typeof vi.fn>;
    readonly registerManifest: ReturnType<typeof vi.fn>;
    /**
     * Resolve the preload the moment it starts, instead of waiting for
     * {@link PreloadHarness.settle}.
     *
     * The warm-hardware case, and the one the beat exists for: the load is done
     * before anything could have been shown, so a beat that armed on the wait
     * still being live would show nothing at all.
     */
    settleOnCall: boolean;
    settle(outcome: 'resolve' | 'reject'): void;
}

function createPreloadHarness(): PreloadHarness {
    let settlePreload: ((outcome: 'resolve' | 'reject') => void) | undefined;
    const preloadCritical = vi.fn(() => {
        if (state.settleOnCall) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
            settlePreload = (outcome) => {
                if (outcome === 'resolve') {
                    resolve();
                } else {
                    reject(new Error('texture 404'));
                }
            };
        });
    });
    const registerManifest = vi.fn();
    const assetManager = {
        registerManifest,
        preloadCritical,
        get: () => null,
        load: () => Promise.reject(new Error('not used')),
        getManifestMetadata: () => undefined,
        dispose: vi.fn(),
    } as unknown as AssetManager;

    const state: PreloadHarness = {
        assetManager,
        preloadCritical,
        registerManifest,
        settleOnCall: false,
        settle: (outcome) => {
            if (settlePreload === undefined) {
                throw new Error('The preload has not started.');
            }
            settlePreload(outcome);
        },
    };
    return state;
}

/** One attribute off the mocked shell — the seam the beat drives. */
function shellAttr(name: string): string | null {
    return screen.getByTestId('mock-game-shell').getAttribute(name);
}

/**
 * The route under a curtain whose fades really move it.
 *
 * `makeFade` returns a fixed opacity, which is right for a case that only reads
 * what the entry started at. It is not enough for the darkening leg: the beat
 * ends that leg on the curtain being OBSERVED opaque, so a double whose
 * `fadeOut` resolves without moving anything parks the beat there forever —
 * and a case built on it would measure a stall rather than a sequence.
 */
function StatefulFadeGame({ initialOpacity }: { initialOpacity: number }): React.ReactElement {
    const [opacity, setOpacity] = React.useState(initialOpacity);
    const control = React.useMemo<FadeControl>(() => {
        const runFadeOut = async (durationMs?: number): Promise<void> => {
            fadeOut(durationMs);
            setOpacity(1);
        };
        const runFadeIn = async (durationMs?: number): Promise<void> => {
            fadeIn(durationMs);
            setOpacity(0);
        };
        return {
            phase: opacity >= 1 ? 'hold' : 'idle',
            opacity,
            setPhase: vi.fn(),
            fadeOut: runFadeOut,
            fadeIn: runFadeIn,
            claim: () => ({ isActive: true, fadeOut: runFadeOut, fadeIn: runFadeIn }),
        };
    }, [opacity]);

    return (
        <I18nProvider>
            <FadeContext.Provider value={control}>
                <GamePage />
            </FadeContext.Provider>
        </I18nProvider>
    );
}

let harness: PreloadHarness;
let fadeIn: ReturnType<typeof vi.fn>;
let fadeOut: ReturnType<typeof vi.fn>;

function makeFade(opacity = 1): FadeControl {
    return {
        phase: opacity === 0 ? 'idle' : 'hold',
        opacity,
        setPhase: vi.fn(),
        fadeOut,
        fadeIn,
        // Sessions delegate to the same spies, so a caller that fades through a
        // claim is recorded exactly like one that fades directly.
        claim: () => ({ isActive: true, fadeOut, fadeIn }),
    };
}

function manifestWithCritical(): AssetManifest {
    return {
        gameId: 'demo',
        entries: [
            { ref: CRITICAL_REF, kind: 'texture', priority: 'critical' },
            { ref: DEFERRED_REF, kind: 'texture', priority: 'deferred' },
        ],
    };
}

function makeRegistry(overrides: Partial<GameScreenRegistry> = {}): GameScreenRegistry {
    return { playfield: () => null, ...overrides };
}

/**
 * What `loadRendererGame` resolves to, with whatever registry slots a case adds.
 *
 * The default here IS the `beforeEach` default, so a case that only declares a
 * cover keeps every other slot the suite runs on — one place to change rather
 * than one per call site silently drifting out of the default.
 */
function makeLoadedGame(registryOverrides: Partial<GameScreenRegistry> = {}): {
    readonly registry: GameScreenRegistry;
    readonly assetManifest: AssetManifest;
} {
    return {
        registry: makeRegistry({
            sceneDefaultScreens: { 'engine:game': 'playfield' },
            ...registryOverrides,
        }),
        assetManifest: manifestWithCritical(),
    };
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    const id = playerId('p1');
    return {
        tick: 5,
        viewerId: id,
        players: { [id]: { id } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        sceneId: 'engine:game',
        ...overrides,
    } as unknown as PlayerSnapshot;
}

function makeLobbyState(): LobbyState {
    return {
        info: { sessionId: 'session-1', hostId: 'p1', gameId: 'demo' },
        players: [{ playerId: 'p1', displayName: 'Player One', ready: true }],
    };
}

function gameTree(fade: FadeControl): React.ReactElement {
    return (
        <I18nProvider>
            <FadeContext.Provider value={fade}>
                <GamePage />
            </FadeContext.Provider>
        </I18nProvider>
    );
}

function renderGame(fade: FadeControl = makeFade()): ReturnType<typeof render> {
    return render(gameTree(fade));
}

/**
 * Drains a just-rendered route to quiescence, so every read after it is exact.
 *
 * `render` is a synchronous act, and the mocked `loadRendererGame` resolves in
 * the microtask right after it returns. Had the next await been a `findBy` or a
 * `waitFor`, that microtask would fire OUTSIDE act, and every render it starts
 * — the shell mount, then each of the beat's phases, a scheduler task apiece —
 * would race the single `setTimeout(0)` testing-library drains with before it
 * hands control back. Under CPU load the timer fires first and a case reads the
 * render before the one it needs. Entering the act scope first means the work
 * that microtask schedules, and everything it cascades into, lands on act's own
 * queue, which act flushes until that queue is empty.
 */
async function drainMount(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

/**
 * Mounts the route, drains it, and pins that the shell is up — the gate never
 * withholds it — and that the preload has started.
 */
async function renderMountedGame(
    fade: FadeControl = makeFade(),
): Promise<ReturnType<typeof render>> {
    const view = renderGame(fade);
    await drainMount();
    expect(screen.getByTestId('mock-game-shell')).toBeInTheDocument();
    expect(harness.preloadCritical).toHaveBeenCalled();
    return view;
}

/**
 * Re-renders the route.
 *
 * The route subscribes to the game/lobby/save stores, all of which are mocked
 * here as plain readers of the `mock*` variables — so changing one of those
 * variables changes nothing until React renders again. `rerender` is that
 * trigger; without it a case that "changes the phase" asserts against the tree
 * it already had.
 */
async function rerenderGame(
    view: ReturnType<typeof render>,
    fade: FadeControl = makeFade(),
): Promise<void> {
    await act(async () => {
        view.rerender(gameTree(fade));
        await Promise.resolve();
    });
}

async function settlePreload(outcome: 'resolve' | 'reject' = 'resolve'): Promise<void> {
    await act(async () => {
        harness.settle(outcome);
        await Promise.resolve();
    });
}

beforeEach(() => {
    harness = createPreloadHarness();
    fadeIn = vi.fn(() => Promise.resolve());
    fadeOut = vi.fn(() => Promise.resolve());
    mockSnapshot = makeSnapshot();
    mockLobbyState = makeLobbyState();
    mockLeavingToMainMenu = false;
    mockRestoreAbortPending = false;
    mockRestore = null;
    mockScenePending = null;
    mockReplace.mockClear();
    assetManagerFor.mockReset();
    assetManagerFor.mockImplementation((loadedGame: unknown) =>
        loadedGame === null ? null : harness.assetManager,
    );
    loadRendererGameMock.mockReset();
    loadRendererGameMock.mockResolvedValue(makeLoadedGame());
    useUiStore.getState().resetScreenNavigation();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

// ── Cases ──────────────────────────────────────────────────────────────────────

// Every case below stubs the e2e flag unless it says otherwise. That collapses
// `screenFadeMs()` and the beat's floor to `0`, which is what makes the beat's
// legs land in one commit chain instead of over real fade durations. The cases
// that measure the beat's TIMING opt out and drive fake timers instead.
beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
});

describe('GamePage reveal gate', () => {
    // Both entry shapes. The route reads the curtain's opacity only to decide
    // whether it still owes a fade to black — never to choose a reveal path —
    // so a cold direct boot, whose curtain starts transparent, and a lobby→game
    // hop that already faded out reach the same place.
    it.each([
        ['a hop that faded out to black', 1],
        ['a cold boot whose scrim is already transparent', 0],
    ])(
        'mounts the shell but withholds the reveal while the preload runs — %s',
        async (_entry, opacity) => {
            await renderMountedGame(makeFade(opacity));

            // The whole feature in one assertion pair: the shell IS in the DOM
            // (a mount gate would orphan the manager GameShell alone disposes,
            // Invariant #21) and the reveal is still withheld.
            expect(screen.getByTestId('mock-game-shell')).toBeInTheDocument();
            expect(fadeIn).not.toHaveBeenCalled();
            expect(shellAttr('data-menu-mounted')).toBe('false');
        },
    );

    it('mounts the HUD row while the preload still runs, ahead of the reveal', async () => {
        // Measured on 1.0.0-rc.7 against a single-model scene: the row mounted
        // on the same commit that commanded the fade-in, so the grid it
        // re-shaped re-fit the canvas — the letterbox observer, then r3f's own
        // `gl.setSize` — some 60 ms INTO a fade the player was watching, and
        // the scene visibly rescaled and shifted. The row has to be up before
        // the fade is asked for, not with it.
        await renderMountedGame(makeFade(1));

        expect(shellAttr('data-hud-mounted')).toBe('true');
        // Against the reveal, not merely against a clock: a row mounted early
        // is only a fix while the screen it lands on is still opaque.
        expect(fadeIn).not.toHaveBeenCalled();
        expect(shellAttr('data-menu-mounted')).toBe('false');
    });

    it('leaves the HUD row out while the curtain is still coming down', async () => {
        // The control for the case above, and the reason the row is not simply
        // mounted with the shell: a cold boot arrives LIT, and a row mounted
        // there re-fits the canvas in front of the player just the same. The
        // fade-out this entry owes has not landed yet, because the curtain
        // double reports the opacity it was constructed with.
        await renderMountedGame(makeFade(0));

        expect(fadeOut).toHaveBeenCalled();
        expect(shellAttr('data-reveal-phase')).toBe('darkening');
        expect(shellAttr('data-hud-mounted')).toBe('false');
    });

    it('reveals a faded hop once the preload settles', async () => {
        await renderMountedGame(makeFade(1));

        await settlePreload();

        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(shellAttr('data-menu-mounted')).toBe('true');
    });

    it('darkens a cold boot first, then reveals it once the preload settles', async () => {
        // The entry that arrives lit. The beat owes it a fade to black before
        // anything else, so the reveal is one leg further away than on a hop
        // that already faded out — and only a curtain that really moves can
        // show that, since the darkening leg ends on the curtain being opaque.
        render(<StatefulFadeGame initialOpacity={0} />);
        await drainMount();
        expect(harness.preloadCritical).toHaveBeenCalled();

        expect(fadeOut).toHaveBeenCalled();
        expect(fadeIn).not.toHaveBeenCalled();

        await settlePreload();

        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(shellAttr('data-menu-mounted')).toBe('true');
    });

    it('reveals exactly once across later renders', async () => {
        const view = await renderMountedGame();
        await settlePreload();

        mockSnapshot = makeSnapshot({ tick: 6 });
        await rerenderGame(view);
        mockSnapshot = makeSnapshot({ tick: 7 });
        await rerenderGame(view);

        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it('reveals when the budget elapses on a preload that never settles', async () => {
        // The budget is a RELEASE, and it does not collapse under the flag —
        // it is what guarantees the gate lets go at all (Invariant #133).
        vi.useFakeTimers();
        renderGame();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(screen.getByTestId('mock-game-shell')).toBeInTheDocument();
        expect(fadeIn).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(CRITICAL_ASSET_PRELOAD_BUDGET_MS);
        });

        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(shellAttr('data-menu-mounted')).toBe('true');
    });

    it.each([['resolve'], ['reject']] as const)(
        'reveals when the preload settles by %s',
        async (outcome) => {
            await renderMountedGame();
            expect(shellAttr('data-menu-mounted')).toBe('false');

            await settlePreload(outcome);

            // The beat reads readiness, never the outcome: a reveal withheld on
            // the failure path would leave the player on a screen with no way
            // forward, and that is the path that most needs the UI.
            expect(shellAttr('data-menu-mounted')).toBe('true');
            expect(fadeIn).toHaveBeenCalledTimes(1);
        },
    );

    it('issues no reveal while a leave is in flight', async () => {
        mockLeavingToMainMenu = true;
        await renderMountedGame();
        await settlePreload();

        // The leave already faded OUT to black; fading back in here would flash
        // the game the player is leaving.
        expect(fadeOut).toHaveBeenCalled();
        expect(fadeIn).not.toHaveBeenCalled();
    });

    it('issues no reveal while the snapshot is still in the lobby phase', async () => {
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });
        await renderMountedGame();
        await settlePreload();

        expect(fadeIn).not.toHaveBeenCalled();
    });

    it('does not retry a suppressed reveal once the phase clears', async () => {
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });
        const view = await renderMountedGame();
        await settlePreload();

        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });
        await rerenderGame(view);

        // Suppression is terminal for the activation. Safe only because each
        // suppressor ends by leaving this route: a leave navigates away, and
        // the phase:'lobby' window ends at /lobby, which fades itself in.
        // Resuming here would fade back in over that navigation.
        expect(fadeIn).not.toHaveBeenCalled();
    });

    it('runs a fresh beat when the route drops out of shell-ready and returns', async () => {
        const view = await renderMountedGame();
        await settlePreload();
        expect(fadeIn).toHaveBeenCalledTimes(1);

        mockSnapshot = null;
        await rerenderGame(view);
        expect(screen.queryByTestId('mock-game-shell')).not.toBeInTheDocument();

        mockSnapshot = makeSnapshot();
        await rerenderGame(view);

        expect(fadeIn).toHaveBeenCalledTimes(2);
    });

    it('reveals immediately while the restore slice is waiting', async () => {
        mockRestore = { state: 'waiting' };
        await renderMountedGame();

        // RestoreWaitingOverlay is a Modal at --ch-z-modal, under both the
        // curtain at --ch-z-screen-fade and the cover at --ch-z-loading-hud:
        // holding the reveal here hides the only control that can abort it.
        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(shellAttr('data-menu-mounted')).toBe('true');
        expect(harness.preloadCritical).toHaveBeenCalledTimes(1);
    });

    it('does not replay the beat when the restore wait ends with the preload still running', async () => {
        mockRestore = { state: 'waiting' };
        const view = await renderMountedGame();
        expect(fadeIn).toHaveBeenCalledTimes(1);

        mockRestore = { state: 'ready' };
        await rerenderGame(view);

        // The player has been looking at the scene since the release above.
        // Dropping them back behind a loading screen — after they have already
        // seen the board — reads as a regression, not as a beat.
        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(shellAttr('data-menu-mounted')).toBe('true');
    });

    it('reveals BEFORE routing to /saves when a restore is aborted mid-preload', async () => {
        mockRestoreAbortPending = true;
        renderGame();
        await waitFor(() => {
            expect(mockReplace).toHaveBeenCalled();
        });

        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(mockReplace).toHaveBeenCalledWith('/saves');
        // /saves has no mount fade-in of its own, so a hop that leaves the
        // curtain opaque strands the player on a black screen.
        expect(fadeIn.mock.invocationCallOrder[0]).toBeLessThan(
            mockReplace.mock.invocationCallOrder[0]!,
        );
    });

    it('leaves the curtain alone on an abort that already reached a transparent screen', async () => {
        // The abort asks the curtain where it is rather than tracking whether a
        // fade happened, so a screen already transparent is not re-faded.
        mockRestoreAbortPending = true;
        renderGame(makeFade(0));
        await waitFor(() => {
            expect(mockReplace).toHaveBeenCalled();
        });

        expect(fadeIn).not.toHaveBeenCalled();
    });

    /**
     * Re-point the loaded game at a registry that DECLARES a cover.
     *
     * The `beforeEach` default declares none, and the chunk fold is conditioned
     * on a declared cover — so a case that means to measure the fold has to say
     * so, or it silently measures the undeclared arm instead.
     */
    function declareCover(): void {
        loadRendererGameMock.mockResolvedValue(makeLoadedGame({ loadingScreen: 'spinner' }));
    }

    it('withholds the reveal while a covered entry’s chunk is still in flight', async () => {
        // The asset gate can settle while the screen's own code-split chunk is
        // not here yet. An entry whose cascade declares a cover folds that wait
        // into the beat's settle term too, because the cover is what the player
        // looks at meanwhile.
        declareCover();
        mockScenePending = true;
        await renderMountedGame();

        await settlePreload();

        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(shellAttr('data-menu-mounted')).toBe('false');
        expect(fadeIn).not.toHaveBeenCalled();
    });

    it('reveals once the chunk lands, with the gate already settled', async () => {
        // The release edge of the case above — without it, "withheld" could be
        // a beat that never reveals at all.
        declareCover();
        mockScenePending = true;
        const view = await renderMountedGame();
        await settlePreload();

        mockScenePending = false;
        await rerenderGame(view);

        expect(shellAttr('data-menu-mounted')).toBe('true');
        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it('reveals an entry that declares no cover on the gate alone, chunk still pending', async () => {
        // Where there is no layer there is no deferral. An undeclared entry
        // PARKS on `covered`, and `covered` mounts no cover (`coverMounted` is
        // the covering legs only), so folding the chunk in there would hold the
        // black curtain over nothing (Invariant #133). It reveals on the asset
        // gate instead.
        mockScenePending = true;
        await renderMountedGame();

        await settlePreload();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(shellAttr('data-menu-mounted')).toBe('true');
        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it('gates on the committed scene’s declared refs', async () => {
        mockSnapshot = makeSnapshot({ sceneRequiredAssets: [DEFERRED_REF] });
        await renderMountedGame();

        // The "required" half of the goal: a route entered on an
        // already-committed scene (a restore, a replay) reaches that scene's
        // declaration only through the snapshot (Invariant #52).
        expect(harness.registerManifest).toHaveBeenCalledTimes(1);
        const promoted = harness.registerManifest.mock.calls[0]?.[0] as AssetManifest;
        expect(promoted.entries.map((entry) => [entry.ref, entry.priority])).toEqual([
            [CRITICAL_REF, 'critical'],
            [DEFERRED_REF, 'critical'],
        ]);
    });
});

// ── The beat itself ────────────────────────────────────────────────────────────

const FLOOR_MS = 400;

/**
 * Mounts the route under fake timers with a game that declares a cover.
 *
 * The e2e stub is dropped for this describe: these cases measure the beat's
 * LEGS, and the flag exists to collapse exactly those. `performance` is faked
 * with the timers because the floor's remainder is a monotonic stamp, and
 * `requestAnimationFrame` because the cover's rise rides a frame.
 */
function installBeatRegistry(overrides: Partial<GameScreenRegistry> = {}): void {
    loadRendererGameMock.mockResolvedValue({
        registry: makeRegistry({
            sceneDefaultScreens: { 'engine:game': 'playfield' },
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: FLOOR_MS,
            ...overrides,
        }),
        assetManifest: manifestWithCritical(),
    });
}

async function mountBeat(fade: FadeControl = makeFade()): Promise<ReturnType<typeof render>> {
    const view = renderGame(fade);
    await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
    });
    return view;
}

/** Advance in steps, so each leg's timer is armed by the render before it. */
async function step(ms: number): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += 20) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(Math.min(20, ms - elapsed));
        });
    }
}

describe('GamePage loading beat', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.useFakeTimers({
            toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame'],
        });
        installBeatRegistry();
    });

    it('shows the cover even when the preload settles before the first frame', async () => {
        // The defect the feature exists for. Measured on 1.0.0-rc.7, a local
        // model settled inside the old reveal grace, so the cover was dropped
        // unseen and the floor never armed — on the hardware that reads a tip
        // fastest, the tip never appeared.
        harness.settleOnCall = true;
        await mountBeat();

        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(shellAttr('data-menu-mounted')).toBe('false');
    });

    it('has the HUD row up for the whole cover, and does not take it down to reveal', async () => {
        // The gap the fix is: with the real floor running, the row is already
        // mounted while the cover is up, so the canvas re-fit it causes has the
        // rest of the cover leg to land in — and it is still mounted at the
        // reveal, because a row that came and went would re-fit twice and put
        // the second one right back inside the fade.
        harness.settleOnCall = true;
        await mountBeat();

        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(shellAttr('data-hud-mounted')).toBe('true');
        expect(fadeIn).not.toHaveBeenCalled();

        await step(SCREEN_FADE_FAST_MS * 3 + FLOOR_MS + 120);

        expect(shellAttr('data-hud-mounted')).toBe('true');
        expect(shellAttr('data-menu-mounted')).toBe('true');
    });

    it('holds the cover for the declared floor, then reveals', async () => {
        harness.settleOnCall = true;
        await mountBeat();
        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();

        await step(SCREEN_FADE_FAST_MS + FLOOR_MS - 40);
        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(fadeIn).not.toHaveBeenCalled();

        await step(SCREEN_FADE_FAST_MS * 2 + 120);
        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(shellAttr('data-menu-mounted')).toBe('true');
    });

    it('ramps its cover down before dropping it, rather than cutting it out', async () => {
        // The page has to hand the cover the beat's LIVE visibility. Handing a
        // constant leaves the cover opaque until it unmounts, which is the cut
        // this sequence exists to replace — the player would go straight from
        // the loading screen to the reveal with no black between them.
        harness.settleOnCall = true;
        await mountBeat();
        const cover = (): HTMLElement => screen.getByTestId('route-entry-loading-cover');

        await step(SCREEN_FADE_FAST_MS + 60);
        expect(cover().style.opacity).toBe('1');

        // Past the floor: the beat is on its closing leg, cover still mounted.
        await step(FLOOR_MS + 40);
        expect(cover().style.opacity).toBe('0');
    });

    it('mounts no cover for a game that declares none', async () => {
        // A game that asked for nothing gets nothing: black until the settle,
        // then one reveal. The negative control for the case above.
        //
        // Built rather than overridden: the slots are optional under
        // `exactOptionalPropertyTypes`, so "declares none" means ABSENT keys,
        // which is also what a real registry looks like.
        loadRendererGameMock.mockResolvedValue({
            registry: makeRegistry({ sceneDefaultScreens: { 'engine:game': 'playfield' } }),
            assetManifest: manifestWithCritical(),
        });
        harness.settleOnCall = true;
        await mountBeat();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        await step(200);
        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it('mounts no cover for the per-key none opt-out', async () => {
        installBeatRegistry({ loadingScreens: { playfield: 'none' } });
        harness.settleOnCall = true;
        await mountBeat();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
    });

    it('darkens before it covers, so the cover never rises over a lit scene', async () => {
        // The cold-boot entry, whose curtain starts transparent. Without the
        // darkening leg the cover would fade up over whatever the route was
        // already showing.
        harness.settleOnCall = true;
        await mountBeat(makeFade(0));

        expect(fadeOut).toHaveBeenCalled();
    });

    it('reports occlusion to the shell until the reveal', async () => {
        harness.settleOnCall = true;
        await mountBeat();
        expect(shellAttr('data-scene-cover-occluded')).toBe('true');

        await step(SCREEN_FADE_FAST_MS * 3 + FLOOR_MS + 120);

        expect(shellAttr('data-scene-cover-occluded')).toBe('false');
    });

    it('publishes its phase for the recorded timeline', async () => {
        harness.settleOnCall = true;
        await mountBeat();

        expect(shellAttr('data-reveal-phase')).not.toBe('revealed');

        await step(SCREEN_FADE_FAST_MS * 3 + FLOOR_MS + 120);

        expect(shellAttr('data-reveal-phase')).toBe('revealed');
    });

    it('collapses every leg under NEXT_PUBLIC_CHIMERA_E2E', async () => {
        // Both durations the beat schedules on come from resolvers that read
        // the flag, so the whole sequence lands without a timer to wait out —
        // and the cover still MOUNTS, which is the structure the recorded
        // timeline reads once the durations are gone.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        harness.settleOnCall = true;
        await mountBeat();

        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(shellAttr('data-menu-mounted')).toBe('true');
    });
});
