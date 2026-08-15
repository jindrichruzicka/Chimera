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

vi.mock('../../components/shell/GameShell', async () => {
    const react = await import('react');
    return {
        GameShell: () => react.createElement('div', { 'data-testid': 'mock-game-shell' }),
    };
});

// ── Harness ────────────────────────────────────────────────────────────────────

interface PreloadHarness {
    readonly assetManager: AssetManager;
    readonly preloadCritical: ReturnType<typeof vi.fn>;
    readonly registerManifest: ReturnType<typeof vi.fn>;
    settle(outcome: 'resolve' | 'reject'): void;
}

function createPreloadHarness(): PreloadHarness {
    let settlePreload: ((outcome: 'resolve' | 'reject') => void) | undefined;
    const preloadCritical = vi.fn(
        () =>
            new Promise<void>((resolve, reject) => {
                settlePreload = (outcome) => {
                    if (outcome === 'resolve') {
                        resolve();
                    } else {
                        reject(new Error('texture 404'));
                    }
                };
            }),
    );
    const registerManifest = vi.fn();
    const assetManager = {
        registerManifest,
        preloadCritical,
        get: () => null,
        load: () => Promise.reject(new Error('not used')),
        getManifestMetadata: () => undefined,
        dispose: vi.fn(),
    } as unknown as AssetManager;

    return {
        assetManager,
        preloadCritical,
        registerManifest,
        settle: (outcome) => {
            if (settlePreload === undefined) {
                throw new Error('The preload has not started.');
            }
            settlePreload(outcome);
        },
    };
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
 * Mounts the route and waits for the shell — the gate never withholds it — AND
 * for the gate's own effect to have started its run.
 *
 * The second wait is not redundant: the shell is in the DOM as soon as the
 * commit lands, while the gate's effect is a passive one React flushes after
 * it. A case that asserted on the run straight after `findByTestId` would be
 * reading a preload that had not necessarily started.
 */
async function renderMountedGame(
    fade: FadeControl = makeFade(),
): Promise<ReturnType<typeof render>> {
    const view = renderGame(fade);
    await screen.findByTestId('mock-game-shell');
    await waitFor(() => {
        expect(harness.preloadCritical).toHaveBeenCalled();
    });
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
    mockReplace.mockClear();
    assetManagerFor.mockReset();
    assetManagerFor.mockImplementation((loadedGame: unknown) =>
        loadedGame === null ? null : harness.assetManager,
    );
    loadRendererGameMock.mockReset();
    loadRendererGameMock.mockResolvedValue({
        registry: makeRegistry({ sceneDefaultScreens: { 'engine:game': 'playfield' } }),
        assetManifest: manifestWithCritical(),
    });
    useUiStore.getState().resetScreenNavigation();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

// ── Cases ──────────────────────────────────────────────────────────────────────

describe('GamePage reveal gate', () => {
    // Both entry shapes. With no declared minimum the hold is structurally
    // inert, so a cold direct boot, whose scrim is already transparent
    // (`FadeProvider` starts at 0), takes exactly the same path as a lobby→game
    // hop that faded out: the fade-in is withheld either way, and on the cold
    // boot it conceals nothing, leaving the route-entry cover as the only thing
    // between the player and a half-loaded scene. The route reads `opacity`
    // only to arm the minimum-visible hold (the describe below) — never to
    // choose a reveal path.
    it.each([
        ['a hop that faded out to black', 1],
        ['a cold boot whose scrim is already transparent', 0],
    ])(
        'mounts the shell but withholds the fade-in while the preload runs — %s',
        async (_entry, opacity) => {
            await renderMountedGame(makeFade(opacity));

            // The whole feature in one assertion pair: the shell IS in the DOM (a
            // mount gate would orphan the manager GameShell alone disposes,
            // Invariant #21) and the reveal is still withheld.
            expect(screen.getByTestId('mock-game-shell')).toBeInTheDocument();
            expect(fadeIn).not.toHaveBeenCalled();
            expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();

            await settlePreload();

            expect(fadeIn).toHaveBeenCalledTimes(1);
            expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        },
    );

    it('fades in exactly once across later renders', async () => {
        const view = await renderMountedGame();
        await settlePreload();

        mockSnapshot = makeSnapshot({ tick: 6 });
        await rerenderGame(view);
        mockSnapshot = makeSnapshot({ tick: 7 });
        await rerenderGame(view);

        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it('fades in when the budget elapses on a preload that never settles', async () => {
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
        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
    });

    it.each([['resolve'], ['reject']] as const)(
        'drops the cover when the preload settles by %s',
        async (outcome) => {
            await renderMountedGame();
            expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();

            await settlePreload(outcome);

            // A cover left standing on the failure path sits at
            // `--ch-z-loading-hud` above every modal and toast for the rest of
            // the match — the failure path is the one that most needs the UI.
            expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
            expect(fadeIn).toHaveBeenCalledTimes(1);
        },
    );

    it('suppresses the fade-in while a leave is in flight', async () => {
        mockLeavingToMainMenu = true;
        await renderMountedGame();
        await settlePreload();

        // The leave already faded OUT to black; fading back in here would flash
        // the game the player is leaving.
        expect(fadeOut).toHaveBeenCalled();
        expect(fadeIn).not.toHaveBeenCalled();
    });

    it('suppresses the fade-in while the snapshot is still in the lobby phase', async () => {
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });
        await renderMountedGame();
        await settlePreload();

        expect(fadeIn).not.toHaveBeenCalled();
    });

    it('does not retry a suppressed fade-in once the phase clears', async () => {
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });
        const view = await renderMountedGame();
        await settlePreload();

        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });
        await rerenderGame(view);

        // Documented, not accidental: the effect's deps are `[sceneReady]`
        // alone, so a suppressed fade-in is never retried when the suppressing
        // condition clears. Safe only because the phase:'lobby' window ends by
        // navigating away, and /lobby fades itself in.
        expect(fadeIn).not.toHaveBeenCalled();
    });

    it('re-arms the latch when the route drops out of shell-ready', async () => {
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

    it('releases the reveal while the restore slice is waiting', async () => {
        mockRestore = { state: 'waiting' };
        await renderMountedGame();

        // RestoreWaitingOverlay is a Modal at --ch-z-modal, under both the scrim
        // at --ch-z-screen-fade and the cover at --ch-z-loading-hud: holding the
        // reveal here hides the only control that can abort the restore.
        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(harness.preloadCritical).toHaveBeenCalledTimes(1);
    });

    it('covers the scene again when the restore wait ends with the preload still running', async () => {
        mockRestore = { state: 'waiting' };
        const view = await renderMountedGame();
        expect(fadeIn).toHaveBeenCalledTimes(1);

        mockRestore = { state: 'ready' };
        await rerenderGame(view);

        // The exit edge of the release above, and intended: the reveal was
        // handed out early so the abort control stayed reachable, not because
        // the scene was ready. With the assets still cold it goes back behind
        // the cover, and the second fade-in ramps from the current opacity, so
        // there is no flash to black.
        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        await settlePreload();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(fadeIn).toHaveBeenCalledTimes(2);
    });

    it('fades in BEFORE routing to /saves when a restore is aborted mid-preload', async () => {
        mockRestoreAbortPending = true;
        renderGame();
        await waitFor(() => {
            expect(mockReplace).toHaveBeenCalled();
        });

        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(mockReplace).toHaveBeenCalledWith('/saves');
        // /saves has no mount fade-in of its own, so a hop that leaves the scrim
        // opaque strands the player on a black screen.
        expect(fadeIn.mock.invocationCallOrder[0]).toBeLessThan(
            mockReplace.mock.invocationCallOrder[0]!,
        );
    });

    it('resolves the cover against the ENTERING scene, not the previous match’s screen', async () => {
        loadRendererGameMock.mockResolvedValue({
            registry: makeRegistry({
                sceneDefaultScreens: { 'engine:game': 'playfield' },
                loadingScreens: {
                    playfield: { message: 'COVER-PLAYFIELD' },
                    summary: { message: 'COVER-SUMMARY' },
                },
            }),
            assetManifest: manifestWithCritical(),
        });
        // What a second match in one process looks like: `uiStore` is a module
        // singleton /game never resets, so `useActiveScreen()` still reads the
        // previous match's post-game screen here.
        useUiStore.getState().navigateToScreen('summary');

        await renderMountedGame();

        expect(await screen.findByText('COVER-PLAYFIELD')).toBeInTheDocument();
        expect(screen.queryByText('COVER-SUMMARY')).not.toBeInTheDocument();
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

// ── Minimum-visible hold (loadingScreenMinVisibleMs) ───────────────────────────

const HOLD_MS = 400;

/**
 * The hold cases run under fake timers (with `performance` faked so the
 * latch's monotonic stamp advances with them), where `waitFor` cannot poll —
 * so the mount flush is an explicit zero-advance, the pattern of the budget
 * case above.
 */
async function mountUnderFakeTimers(fade: FadeControl): Promise<ReturnType<typeof render>> {
    const view = renderGame(fade);
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('mock-game-shell')).toBeInTheDocument();
    expect(harness.preloadCritical).toHaveBeenCalled();
    return view;
}

function installHoldRegistry(overrides: Partial<GameScreenRegistry> = {}): void {
    loadRendererGameMock.mockResolvedValue({
        registry: makeRegistry({
            sceneDefaultScreens: { 'engine:game': 'playfield' },
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: HOLD_MS,
            ...overrides,
        }),
        assetManifest: manifestWithCritical(),
    });
}

describe('GamePage minimum-visible hold', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        installHoldRegistry();
    });

    it('holds the cover and the fade-in until the minimum when the preload settles early', async () => {
        const view = await mountUnderFakeTimers(makeFade(0));
        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        await settlePreload();

        // Settled inside the minimum: the reveal is DEFERRED, both halves.
        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(fadeIn).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(HOLD_MS - 100 - 1);
        });
        expect(screen.getByTestId('route-entry-loading-cover')).toBeInTheDocument();
        expect(fadeIn).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(fadeIn).toHaveBeenCalledTimes(1);

        // The latch is preserved across the held release: later renders never
        // fire a second fade-in.
        mockSnapshot = makeSnapshot({ tick: 6 });
        await rerenderGame(view, makeFade(0));
        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it('reveals immediately when the preload outlives the minimum', async () => {
        await mountUnderFakeTimers(makeFade(0));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(HOLD_MS + 100);
        });
        await settlePreload();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it('arms no hold on the faded entry — an occluded cover extends nothing', async () => {
        // The lobby→game hop: the app scrim is opaque OVER the route subtree,
        // so the cover, though mounted, is not something the player has seen. A
        // mount-stamped hold here extends a black screen.
        await mountUnderFakeTimers(makeFade(1));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        await settlePreload();

        // Reveal AT settle, exactly as with no minimum declared.
        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['the engine placeholder (no declared cover)', { loadingScreen: undefined }],
        ["the per-key 'none' opt-out", { loadingScreens: { playfield: 'none' } } as const],
    ])('arms no hold when the cascade resolves %s', async (_name, overrides) => {
        installHoldRegistry(overrides as Partial<GameScreenRegistry>);
        await mountUnderFakeTimers(makeFade(0));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        await settlePreload();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it('collapses the minimum under NEXT_PUBLIC_CHIMERA_E2E', async () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        await mountUnderFakeTimers(makeFade(0));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        await settlePreload();

        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
        expect(fadeIn).toHaveBeenCalledTimes(1);
    });

    it('releases the reveal for a waiting restore even with a hold pending', async () => {
        const view = await mountUnderFakeTimers(makeFade(0));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        await settlePreload();
        expect(fadeIn).not.toHaveBeenCalled(); // hold pending until t=400

        mockRestore = { state: 'waiting' };
        await rerenderGame(view, makeFade(0));

        // RestoreWaitingOverlay sits under the cover; a hold that outwaited it
        // would hide the only control that can abort the restore.
        expect(fadeIn).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('route-entry-loading-cover')).not.toBeInTheDocument();
    });
});
