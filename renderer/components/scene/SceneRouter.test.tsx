// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type { AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type {
    GameLoadingScreenProps,
    GameScreenProps,
    GameScreenRegistry,
    TransitionOverlayProps,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type { AssetManager } from '../../assets/AssetManager.js';
import { AssetManagerContext } from '../../assets/AssetManagerContext.js';
import {
    createStubAssetManager,
    stubManifest,
    textureRef,
} from '../../assets/__test-support__/StubAssetManager.js';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import { useUiStore } from '../../state/uiStore.js';
import { FadeProvider } from '../shell/FadeContext.js';
import { SceneRouter } from './SceneRouter.js';

const LOCAL_PLAYER = playerId('local-player');

beforeEach(() => {
    useUiStore.getState().resetScreenNavigation();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('SceneRouter', () => {
    it('renders the playfield slot for the active scene by default', async () => {
        renderRouter(makeSnapshot(), makeRegistry());

        expect(await screen.findByTestId('playfield-screen')).toBeTruthy();
    });

    it('renders a named screen selected through uiStore without IPC', async () => {
        useUiStore.getState().setActiveSceneId('engine:game');
        useUiStore.getState().navigateToScreen('tech-tree');

        renderRouter(makeSnapshot(), makeRegistry());

        expect(await screen.findByTestId('tech-tree-screen')).toBeTruthy();
        expect(screen.queryByTestId('playfield-screen')).toBeNull();
    });

    it('resets named screen navigation to playfield when sceneId changes', async () => {
        useUiStore.getState().setActiveSceneId('engine:game');
        useUiStore.getState().navigateToScreen('tech-tree');
        const registry = makeRegistry();

        const { rerender } = renderRouter(
            makeSnapshot({ sceneId: makeSceneId('engine:game') }),
            registry,
        );
        expect(await screen.findByTestId('tech-tree-screen')).toBeTruthy();

        rerender(wrapRouter(makeSnapshot({ sceneId: makeSceneId('engine:post-game') }), registry));

        await waitFor(() => expect(screen.getByTestId('playfield-screen')).toBeTruthy());
        expect(useUiStore.getState().activeScreenKey).toBe('playfield');
    });

    it('uses registry sceneDefaultScreens when a scene changes', async () => {
        useUiStore.getState().setActiveSceneId('engine:game');
        const registry = {
            ...makeRegistry(),
            screens: {
                summary: makeScreen('summary-screen'),
            },
            sceneDefaultScreens: {
                'engine:post-game': 'summary',
            },
        } satisfies GameScreenRegistry;

        renderRouter(makeSnapshot(), registry);
        cleanup();
        renderRouter(makeSnapshot({ sceneId: makeSceneId('engine:post-game') }), registry);

        expect(await screen.findByTestId('summary-screen')).toBeTruthy();
    });

    it('prefers snapshot.sceneDefaultScreen over registry sceneDefaultScreens', async () => {
        useUiStore.getState().setActiveSceneId('engine:game');
        const registry = {
            ...makeRegistry(),
            screens: {
                summary: makeScreen('summary-screen'),
            },
            sceneDefaultScreens: {
                'engine:post-game': 'playfield',
            },
        } satisfies GameScreenRegistry;

        renderRouter(makeSnapshot(), registry);
        cleanup();
        renderRouter(
            makeSnapshot({
                sceneId: makeSceneId('engine:post-game'),
                sceneDefaultScreen: 'summary',
            }),
            registry,
        );

        expect(await screen.findByTestId('summary-screen')).toBeTruthy();
    });

    it('covers every screen key with a registry-level loadingScreen while the chunk loads', () => {
        const registry = {
            ...pendingRegistry(),
            loadingScreen: makeCover('registry-cover'),
        } satisfies GameScreenRegistry;

        renderRouter(makeSnapshot(), registry);

        expect(screen.getByTestId('registry-cover')).toBeTruthy();
        expect(screen.queryByTestId('scene-screen-loading')).toBeNull();
    });

    it('prefers a per-key loadingScreens cover over the registry-level one', () => {
        useUiStore.getState().setActiveSceneId('engine:game');
        useUiStore.getState().navigateToScreen('tech-tree');
        const registry = {
            ...pendingRegistry(),
            loadingScreen: makeCover('registry-cover'),
            loadingScreens: { 'tech-tree': makeCover('per-key-cover') },
        } satisfies GameScreenRegistry;

        renderRouter(makeSnapshot(), registry);

        expect(screen.getByTestId('per-key-cover')).toBeTruthy();
        expect(screen.queryByTestId('registry-cover')).toBeNull();
    });

    it("opts one key out with 'none' while the rest keep the registry-level cover", () => {
        const registry = {
            ...pendingRegistry(),
            loadingScreen: makeCover('registry-cover'),
            loadingScreens: { 'tech-tree': 'none' },
        } satisfies GameScreenRegistry;

        useUiStore.getState().setActiveSceneId('engine:game');
        useUiStore.getState().navigateToScreen('tech-tree');
        renderRouter(makeSnapshot(), registry);

        expect(screen.getByTestId('scene-screen-loading')).toBeTruthy();
        expect(screen.queryByTestId('registry-cover')).toBeNull();

        cleanup();
        useUiStore.getState().resetScreenNavigation();
        renderRouter(makeSnapshot(), registry);

        expect(screen.getByTestId('registry-cover')).toBeTruthy();
    });

    it('reports the resolved key, the scene and a code wait with no measured progress', () => {
        const calls: GameLoadingScreenProps[] = [];
        const registry = {
            ...pendingRegistry(),
            loadingScreen: (props: GameLoadingScreenProps): React.ReactElement => {
                calls.push(props);
                return <div data-testid="recording-cover" />;
            },
        } satisfies GameScreenRegistry;

        renderRouter(makeSnapshot({ sceneId: makeSceneId('engine:post-game') }), registry);

        // The router's boundary stands in for a module that has not resolved, and
        // an import() exposes no progress channel — `null`, never 0.
        expect(calls[0]).toEqual({
            screenKey: 'playfield',
            sceneId: 'engine:post-game',
            reason: 'code',
            progress: null,
        });
    });

    it('renders the transition overlay while a scene transition is preparing', async () => {
        const snapshot = makeSnapshot({
            sceneTransition: {
                toSceneId: makeSceneId('engine:post-game'),
                phase: 'preparing',
                startedAtTick: 3,
                params: {},
                playersReady: [],
            },
        });

        renderRouter(snapshot, makeRegistry(), { fadeDurationMs: 1_000 });

        expect(await screen.findByTestId('transition-overlay')).toBeTruthy();
        expect(screen.getByTestId('transition-overlay').getAttribute('data-fade-phase')).toBe(
            'fade-out',
        );
    });
});

describe('SceneRouter — entering scene asset cover', () => {
    it('renders the asset cover even when the game supplies its own transition overlay', async () => {
        const ref = textureRef('arena');
        // BOTH slots declared: the cover is a SIBLING of the overlay branch, so
        // nesting it inside the `Overlay === undefined` arm makes it unreachable
        // for exactly the games that contribute an overlay.
        const registry = {
            ...plainRegistry(),
            transitionOverlay: makeGameOverlay(),
            loadingScreen: 'spinner',
        } satisfies GameScreenRegistry;

        renderRouter(makeTransitioningSnapshot([ref]), registry, {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        });

        expect(await screen.findByTestId('scene-preload-cover')).toBeTruthy();
        expect(screen.getByTestId('game-transition-overlay')).toBeTruthy();
    });

    it('keeps the cover out of the engine overlay’s aria-hidden subtree', async () => {
        const ref = textureRef('arena');
        const registry = {
            ...plainRegistry(),
            loadingScreen: 'spinner',
        } satisfies GameScreenRegistry;

        renderRouter(makeTransitioningSnapshot([ref]), registry, {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        });

        // DEFAULT options — `getByRole` excludes anything hidden from the
        // accessibility tree, and `TransitionOverlay` is `aria-hidden="true"`.
        // A cover rendered as its child would be unqueryable here.
        const cover = await screen.findByTestId('scene-preload-cover');
        expect(screen.getByTestId('transition-overlay')).toBeTruthy();
        expect(within(cover).getByRole('status')).toBeTruthy();
    });

    it('resolves the cover against the ENTERING scene and its default screen', async () => {
        const calls: GameLoadingScreenProps[] = [];
        const ref = textureRef('arena');
        const registry = {
            ...plainRegistry(),
            sceneDefaultScreens: { 'engine:post-game': 'summary' },
            loadingScreen: (props: GameLoadingScreenProps): React.ReactElement => {
                calls.push(props);
                return <div data-testid="recording-cover" />;
            },
        } satisfies GameScreenRegistry;

        renderRouter(makeTransitioningSnapshot([ref]), registry, {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        });

        await screen.findByTestId('recording-cover');

        // The scene being ENTERED, not `snapshot.sceneId`, which is still the
        // scene being left for the whole `'preparing'` phase; and 0 of 1 ref
        // settled, which is a measurement rather than a stand-in for one.
        expect(calls[0]).toEqual({
            screenKey: 'summary',
            sceneId: 'engine:post-game',
            reason: 'assets',
            progress: 0,
        });
    });

    it('resolves the entering scene’s declared screen when the registry omits it', async () => {
        // The defect: a game that registers a scene through
        // `MainGameContribution.registerScenes` but does not ALSO list it in
        // `GameScreenRegistry.sceneDefaultScreens` used to fall through to
        // `'playfield'`, and with it `'playfield'`'s cover — silently replacing
        // the cover the scene declared, for the whole wait it exists to explain.
        // Nothing reported it: a cover still mounted, still at the same layer,
        // rendering the engine default empty div.
        const calls: GameLoadingScreenProps[] = [];
        const ref = textureRef('arena');
        const registry = {
            ...plainRegistry(),
            // Deliberately EMPTY for the entering scene. A game that declared
            // the entry would resolve through the fallback and prove nothing.
            sceneDefaultScreens: { 'engine:post-game': 'summary' },
            loadingScreen: (props: GameLoadingScreenProps): React.ReactElement => {
                calls.push(props);
                return <div data-testid="recording-cover" />;
            },
        } satisfies GameScreenRegistry;

        renderRouter(
            makeTransitioningSnapshot([ref], {
                toSceneId: 'tactics:asset-demo',
                defaultScreen: 'asset-demo',
            }),
            registry,
            {
                assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
                assetManifest: stubManifest([ref]),
            },
        );

        await screen.findByTestId('recording-cover');

        expect(calls[0]).toEqual({
            screenKey: 'asset-demo',
            sceneId: 'tactics:asset-demo',
            reason: 'assets',
            progress: 0,
        });
    });

    it('prefers the transition’s key over a registry entry that disagrees', async () => {
        // The ORDER of the two sources, which the case above cannot see: there
        // the map simply omits the scene, so either arm first yields the same
        // answer. Here both name the same scene and name it DIFFERENTLY, so only
        // the arm that wins is observable. The host's declaration has to win —
        // the renderer-side map being able to override it is the defect class
        // this change removes, in its disagreeing variant.
        const calls: GameLoadingScreenProps[] = [];
        const ref = textureRef('arena');
        const registry = {
            ...plainRegistry(),
            sceneDefaultScreens: { 'tactics:asset-demo': 'stale-key' },
            loadingScreen: (props: GameLoadingScreenProps): React.ReactElement => {
                calls.push(props);
                return <div data-testid="recording-cover" />;
            },
        } satisfies GameScreenRegistry;

        renderRouter(
            makeTransitioningSnapshot([ref], {
                toSceneId: 'tactics:asset-demo',
                defaultScreen: 'asset-demo',
            }),
            registry,
            {
                assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
                assetManifest: stubManifest([ref]),
            },
        );

        await screen.findByTestId('recording-cover');

        expect(calls[0]?.screenKey).toBe('asset-demo');
    });

    it('falls back to playfield when neither the transition nor the map names a screen', async () => {
        // The last arm of the cascade, which no case above leaves absent on both
        // sources at once, so none of them can see it.
        const calls: GameLoadingScreenProps[] = [];
        const ref = textureRef('arena');
        const registry = {
            ...plainRegistry(),
            loadingScreen: (props: GameLoadingScreenProps): React.ReactElement => {
                calls.push(props);
                return <div data-testid="recording-cover" />;
            },
        } satisfies GameScreenRegistry;

        renderRouter(
            makeTransitioningSnapshot([ref], { toSceneId: 'tactics:asset-demo' }),
            registry,
            {
                assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
                assetManifest: stubManifest([ref]),
            },
        );

        await screen.findByTestId('recording-cover');

        expect(calls[0]?.screenKey).toBe('playfield');
    });

    it('falls back to the registry map when the transition declares no screen', async () => {
        // The other side of the same precedence. A host that predates the
        // transition field emits no `defaultScreen`, and the registry map must
        // still resolve the cover — so the new field is a preference, not a
        // replacement.
        const calls: GameLoadingScreenProps[] = [];
        const ref = textureRef('arena');
        const registry = {
            ...plainRegistry(),
            sceneDefaultScreens: { 'engine:post-game': 'summary' },
            loadingScreen: (props: GameLoadingScreenProps): React.ReactElement => {
                calls.push(props);
                return <div data-testid="recording-cover" />;
            },
        } satisfies GameScreenRegistry;

        renderRouter(makeTransitioningSnapshot([ref]), registry, {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        });

        await screen.findByTestId('recording-cover');

        expect(calls[0]?.screenKey).toBe('summary');
    });

    it('feeds the measured fraction to the engine overlay and to the cover', async () => {
        const first = textureRef('arena');
        const second = textureRef('floor');
        const assetManager = createStubAssetManager({
            [String(first)]: 'deferred',
            [String(second)]: 'deferred',
        });
        const registry = { ...plainRegistry(), loadingScreen: makeReportingCover() };

        renderRouter(makeTransitioningSnapshot([first, second]), registry, {
            assetManager,
            assetManifest: stubManifest([first, second]),
        });

        // The run starts on the far side of the fade, and `registerManifest` is
        // its first act — so this is the point at which a ref can be landed.
        await waitFor(() => expect(assetManager.registered).toHaveLength(1));
        expect(await screen.findByTestId('scene-preload-cover')).toBeTruthy();
        expect(readOverlayProgress()).toBe('0');

        assetManager.settleDeferred(first);
        await waitFor(() => expect(readOverlayProgress()).toBe('0.5'));
        expect(screen.getByTestId('reporting-cover').dataset['progress']).toBe('0.5');

        assetManager.settleDeferred(second);
        await waitFor(() => expect(readOverlayProgress()).toBe('1'));
        expect(screen.getByTestId('reporting-cover').dataset['progress']).toBe('1');
    });

    it('holds the last fraction for a game overlay until the transition ends', async () => {
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const assetManifest = stubManifest([ref]);
        const registry = {
            ...plainRegistry(),
            transitionOverlay: makeGameOverlay(),
        } satisfies GameScreenRegistry;

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, {
            assetManager,
            assetManifest,
        });

        await waitFor(() => expect(assetManager.registered).toHaveLength(1));
        assetManager.settleDeferred(ref);
        await waitFor(() => expect(readGameOverlayProgress()).toBe('1'));

        // The ack lands: this player joins `playersReady` and the transition
        // moves on. The terminal fraction must survive that turn — blanked here
        // it would flash the cover empty on the way out.
        rerender(
            wrapRouter(
                makeTransitioningSnapshot([ref], {
                    tick: 4,
                    phase: 'committing',
                    playersReady: [LOCAL_PLAYER],
                }),
                registry,
                { assetManager, assetManifest },
            ),
        );
        expect(readGameOverlayProgress()).toBe('1');

        rerender(
            wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, {
                assetManager,
                assetManifest,
            }),
        );

        await waitFor(() => expect(readGameOverlayProgress()).toBe('absent'));
    });

    // The byte-identity claim measured at the WIRED seam, not on
    // `TransitionOverlay` in isolation: the run's own no-op path reports `1`,
    // and a router that passed that on would author "100% preloaded" over a
    // wait nobody counted, for every transition in every game shipping no
    // manifest.
    it.each([
        [
            'the entering scene declares no refs',
            (): RouterOptions => ({
                assetManager: createStubAssetManager(),
                assetManifest: stubManifest([textureRef('arena')]),
            }),
            [] as readonly AssetRef[],
        ],
        [
            'the game ships no manifest',
            (): RouterOptions => ({ assetManager: createStubAssetManager() }),
            [textureRef('arena')] as readonly AssetRef[],
        ],
        [
            'no asset manager is in context',
            (): RouterOptions => ({ assetManifest: stubManifest([textureRef('arena')]) }),
            [textureRef('arena')] as readonly AssetRef[],
        ],
    ])(
        'leaves the overlay untouched and shows no cover when %s',
        async (_case, options, requiredAssets) => {
            renderRouter(makeTransitioningSnapshot(requiredAssets), plainRegistry(), options());

            // Anchored on the OBSERVABLE end of the fade — the overlay's phase
            // flips to 'hold' when `fadeOut` settles — and never on a wall-clock
            // budget: a sleep that expires before the fade resolves passes these
            // three vacuously, which is green for the wrong reason.
            await waitFor(() =>
                expect(
                    screen.getByTestId('transition-overlay').getAttribute('data-fade-phase'),
                ).toBe('hold'),
            );
            // One macrotask drains the preload step's whole microtask chain,
            // which runs in the same `.then()` as that flip.
            await act(async () => {
                await new Promise((resolve) => {
                    setTimeout(resolve, 0);
                });
            });

            const overlay = screen.getByTestId('transition-overlay');
            expect(overlay.hasAttribute('data-preload-progress')).toBe(false);
            expect([...overlay.getAttributeNames()].sort()).toEqual([
                'aria-hidden',
                'data-fade-phase',
                'data-testid',
                'style',
            ]);
            expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        },
    );

    // Every placement axis is its own mutant: the layer is only a layer if it
    // fills its container, sits ABOVE the opaque scene fade (`--ch-z-scene-fade`
    // is 130, this is 150) and — being a cover the contract gives no way to
    // dispatch from — never eats a click meant for whatever is underneath.
    it.each([
        ['position', 'absolute'],
        ['inset', '0px'],
        ['zIndex', 'var(--ch-z-loading-hud)'],
        ['pointerEvents', 'none'],
    ])('sets %s on the cover layer', async (property, value) => {
        const ref = textureRef('arena');

        renderRouter(makeTransitioningSnapshot([ref]), plainRegistry(), {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        });

        const layer = await screen.findByTestId('scene-preload-cover');
        expect(layer.style[property as unknown as number]).toBe(value);
    });
});

function readOverlayProgress(): string | null {
    return screen.getByTestId('transition-overlay').getAttribute('data-preload-progress');
}

function readGameOverlayProgress(): string | undefined {
    return screen.getByTestId('game-transition-overlay').dataset['preloadProgress'];
}

/**
 * A registry whose playfield mounts synchronously, so the router's own Suspense
 * boundary never renders a `'code'` cover — the only cover in these trees is the
 * asset one under test.
 */
function plainRegistry(): GameScreenRegistry {
    return { playfield: PlainPlayfield };
}

function PlainPlayfield(_props: GameScreenProps): React.ReactElement {
    return <div data-testid="playfield-screen" />;
}

/**
 * A game overlay that reports the fraction it was handed, distinguishing an
 * ABSENT prop from a present one — the contract gives those two states different
 * meanings ("no preload running" vs "running, unmeasured").
 */
function makeGameOverlay(): (props: TransitionOverlayProps) => React.ReactElement {
    return (props: TransitionOverlayProps): React.ReactElement => (
        <div
            data-testid="game-transition-overlay"
            data-preload-progress={
                'preloadProgress' in props ? String(props.preloadProgress) : 'absent'
            }
        />
    );
}

/** A game cover that reports the fraction it was handed. */
function makeReportingCover(): (props: GameLoadingScreenProps) => React.ReactElement {
    return (props: GameLoadingScreenProps): React.ReactElement => (
        <div data-testid="reporting-cover" data-progress={String(props.progress)} />
    );
}

function makeTransitioningSnapshot(
    requiredAssets: readonly AssetRef[],
    overrides: {
        readonly tick?: number;
        readonly phase?: 'preparing' | 'ready' | 'committing';
        readonly playersReady?: readonly ReturnType<typeof playerId>[];
        readonly toSceneId?: string;
        readonly defaultScreen?: string;
    } = {},
): PlayerSnapshot {
    return makeSnapshot({
        tick: overrides.tick ?? 3,
        sceneTransition: {
            toSceneId: makeSceneId(overrides.toSceneId ?? 'engine:post-game'),
            phase: overrides.phase ?? 'preparing',
            startedAtTick: 2,
            params: {},
            playersReady: overrides.playersReady ?? [],
            requiredAssets,
            ...(overrides.defaultScreen === undefined
                ? {}
                : { defaultScreen: overrides.defaultScreen }),
        },
    });
}

interface RouterOptions {
    readonly fadeDurationMs?: number;
    readonly assetManager?: AssetManager;
    readonly assetManifest?: ReturnType<typeof stubManifest>;
    readonly sceneCoverOccluded?: boolean;
}

function renderRouter(
    snapshot: PlayerSnapshot,
    registry: GameScreenRegistry,
    options: RouterOptions = {},
): ReturnType<typeof render> {
    return render(wrapRouter(snapshot, registry, options));
}

function wrapRouter(
    snapshot: PlayerSnapshot,
    registry: GameScreenRegistry,
    options: RouterOptions = {},
): React.ReactElement {
    const fadeDurationMs = options.fadeDurationMs ?? 1;

    return (
        <I18nProvider>
            <AssetManagerContext.Provider value={options.assetManager ?? null}>
                <FadeProvider>
                    <SceneRouter
                        registry={registry}
                        snapshot={snapshot}
                        localPlayerId={LOCAL_PLAYER}
                        sendAction={vi.fn()}
                        fadeOutMs={fadeDurationMs}
                        fadeInMs={fadeDurationMs}
                        {...(options.assetManifest === undefined
                            ? {}
                            : { assetManifest: options.assetManifest })}
                        {...(options.sceneCoverOccluded === undefined
                            ? {}
                            : { sceneCoverOccluded: options.sceneCoverOccluded })}
                    />
                </FadeProvider>
            </AssetManagerContext.Provider>
        </I18nProvider>
    );
}

function makeScreen(
    testId: string,
): React.LazyExoticComponent<React.ComponentType<GameScreenProps>> {
    return React.lazy(() =>
        Promise.resolve({
            default: (_props: GameScreenProps) => <div data-testid={testId} />,
        }),
    );
}

/**
 * A registry whose screens never resolve, so the router's Suspense fallback —
 * the cover under test — stays mounted for the whole assertion.
 */
function pendingRegistry(): GameScreenRegistry {
    const pending = React.lazy(
        () => new Promise<{ default: React.ComponentType<GameScreenProps> }>(() => {}),
    );

    return { playfield: pending, screens: { 'tech-tree': pending } };
}

function makeCover(testId: string): (props: GameLoadingScreenProps) => React.ReactElement {
    return (_props: GameLoadingScreenProps): React.ReactElement => <div data-testid={testId} />;
}

function makeRegistry(): GameScreenRegistry {
    const Playfield = makeScreen('playfield-screen');
    const TechTree = makeScreen('tech-tree-screen');

    return {
        playfield: Playfield,
        screens: {
            'tech-tree': TechTree,
        },
    };
}

function makeSceneId(raw: string): NonNullable<PlayerSnapshot['sceneId']> {
    return raw as NonNullable<PlayerSnapshot['sceneId']>;
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    return {
        tick: 3,
        viewerId: LOCAL_PLAYER,
        players: { [LOCAL_PLAYER]: { id: LOCAL_PLAYER } },
        entities: {},
        phase: gamePhase('playing'),
        sceneId: makeSceneId('engine:game'),
        sceneTransition: null,
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}

// ── Minimum-visible held layer (§4.36, loadingScreenMinVisibleMs) ──────────────

const MIN_VISIBLE_MS = 400;

/** Advance fake time inside act, flushing the microtask chain along the way. */
async function tickMs(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

/** A cover reporting every prop, so the held copy's content is assertable. */
function makeFullReportingCover(): (props: GameLoadingScreenProps) => React.ReactElement {
    return (props: GameLoadingScreenProps): React.ReactElement => (
        <div
            data-testid="reporting-cover"
            data-progress={String(props.progress)}
            data-reason={props.reason}
            data-screen-key={props.screenKey}
        />
    );
}

/** A REAL React.lazy screen whose module resolution the test owns. */
function makeControlledScreen(testId: string): {
    readonly Screen: React.LazyExoticComponent<React.ComponentType<GameScreenProps>>;
    resolve(): void;
} {
    let resolveModule: (() => void) | undefined;
    const Screen = React.lazy(
        () =>
            new Promise<{ default: React.ComponentType<GameScreenProps> }>((res) => {
                resolveModule = () => {
                    res({ default: () => <div data-testid={testId} /> });
                };
            }),
    );
    return { Screen, resolve: () => resolveModule?.() };
}

describe('SceneRouter — minimum-visible held layer', () => {
    beforeEach(() => {
        // `performance` faked so the latch's monotonic stamp advances with the
        // timers; `requestAnimationFrame` faked so the fade's frame clock does
        // too (frames land on 16ms ticks — the fade-out completes at T=16 and
        // the preload cover rises there).
        vi.useFakeTimers({
            toFake: [
                'setTimeout',
                'clearTimeout',
                'performance',
                'requestAnimationFrame',
                'cancelAnimationFrame',
            ],
        });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    function heldRegistry(overrides: Partial<GameScreenRegistry> = {}): GameScreenRegistry {
        return {
            ...plainRegistry(),
            loadingScreen: makeFullReportingCover(),
            loadingScreenMinVisibleMs: MIN_VISIBLE_MS,
            ...overrides,
        };
    }

    it('holds the transition cover past the commit with its last measured fraction', async () => {
        const first = textureRef('arena');
        const second = textureRef('floor');
        const assetManager = createStubAssetManager({
            [String(first)]: 'deferred',
            [String(second)]: 'deferred',
        });
        const assetManifest = stubManifest([first, second]);
        // A non-default key for the entering scene, so the held copy carrying
        // the ENTERING scene's resolution (not a 'playfield' fallback) shows.
        const registry = heldRegistry({
            sceneDefaultScreens: { 'engine:post-game': 'summary' },
        });
        const options = { assetManager, assetManifest };

        const { rerender } = renderRouter(
            makeTransitioningSnapshot([first, second]),
            registry,
            options,
        );
        await tickMs(16); // fade-out completes; cover rises at T=16
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await act(async () => {
            assetManager.settleDeferred(first);
            await Promise.resolve();
        });
        await tickMs(0);
        expect(screen.getByTestId('reporting-cover').dataset['progress']).toBe('0.5');

        await tickMs(84); // T=100
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        // The live cover dropped WITH the commit; the held copy stands in its
        // place, same resolution, last measured fraction — snapshotted from the
        // covered renders, since the commit render can no longer compute it.
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        const held = screen.getByTestId('scene-held-cover');
        const heldCover = within(held).getByTestId('reporting-cover');
        expect(heldCover.dataset['progress']).toBe('0.5');
        expect(heldCover.dataset['reason']).toBe('assets');
        expect(heldCover.dataset['screenKey']).toBe('summary');

        // The transition lifecycle beneath is NOT deferred: the engine overlay
        // unmounted with the commit, the whole time the held layer stands. (The
        // fade/ack half of that claim is structural — useFadeTransition.ts is
        // unmodified on this branch.)
        await tickMs(299); // T=399... release lands at T=416 (rise 16 + 400)
        expect(screen.queryByTestId('transition-overlay')).toBeNull();
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();

        await tickMs(16); // T=415
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(1); // T=416
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('drops the transition cover with the commit when the minimum has already elapsed', async () => {
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const assetManifest = stubManifest([ref]);
        const registry = heldRegistry();
        const options = { assetManager, assetManifest };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await tickMs(MIN_VISIBLE_MS + 100); // T=516 > 416
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('keeps the held preset cover in the accessibility tree', async () => {
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const assetManifest = stubManifest([ref]);
        const registry = heldRegistry({ loadingScreen: 'spinner' });
        const options = { assetManager, assetManifest };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16);

        await tickMs(84);
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        const held = screen.getByTestId('scene-held-cover');
        expect(within(held).getByRole('status')).toBeTruthy();
    });

    it('holds a resolved Suspense cover as the held layer with the screen running underneath', async () => {
        const { Screen, resolve } = makeControlledScreen('resolved-screen');
        const registry = heldRegistry({ playfield: Screen });

        renderRouter(makeSnapshot(), registry, {});
        await tickMs(0); // fallback mounts; rise stamps at T=0
        expect(screen.getByTestId('reporting-cover').dataset['reason']).toBe('code');

        await tickMs(100);
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(0);

        // The screen mounted the moment its chunk resolved — the hold covers
        // sight, never mount — and the held copy renders reason="code".
        expect(screen.getByTestId('resolved-screen')).toBeTruthy();
        const held = screen.getByTestId('scene-held-cover');
        const heldCover = within(held).getByTestId('reporting-cover');
        expect(heldCover.dataset['reason']).toBe('code');
        expect(heldCover.dataset['progress']).toBe('null');

        await tickMs(MIN_VISIBLE_MS - 100 - 1); // T=399
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(1); // T=400
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
        expect(screen.getByTestId('resolved-screen')).toBeTruthy();
    });

    it('drops a Suspense cover immediately when its chunk outlives the minimum', async () => {
        const { Screen, resolve } = makeControlledScreen('resolved-screen');
        const registry = heldRegistry({ playfield: Screen });

        renderRouter(makeSnapshot(), registry, {});
        await tickMs(0);
        await tickMs(MIN_VISIBLE_MS + 100);

        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(0);

        expect(screen.getByTestId('resolved-screen')).toBeTruthy();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('arms nothing for a screen that never suspends', async () => {
        renderRouter(makeSnapshot(), heldRegistry(), {});
        await tickMs(0);
        await tickMs(MIN_VISIBLE_MS);

        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
        expect(screen.getByTestId('playfield-screen')).toBeTruthy();
    });

    it('never arms a code hold under an outer cover', async () => {
        const { Screen, resolve } = makeControlledScreen('resolved-screen');
        const registry = heldRegistry({ playfield: Screen });

        renderRouter(makeSnapshot(), registry, { sceneCoverOccluded: true });
        await tickMs(0);
        await tickMs(100);

        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(0);

        // The route cover (or the opaque scrim) sat above the fallback for its
        // whole lifetime: nobody saw it, so nothing is held.
        expect(screen.getByTestId('resolved-screen')).toBeTruthy();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('a new transition supersedes the held layer, and its cover then stands alone', async () => {
        const { Screen, resolve } = makeControlledScreen('resolved-screen');
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'hang' });
        const assetManifest = stubManifest([ref]);
        const registry = heldRegistry({ playfield: Screen });
        const options = { assetManager, assetManifest };

        const { rerender } = renderRouter(makeSnapshot(), registry, options);
        await tickMs(0);
        await tickMs(100);
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(50); // T=150: held layer standing (release due at 400)
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();

        await act(async () => {
            rerender(wrapRouter(makeTransitioningSnapshot([ref]), registry, options));
            await Promise.resolve();
        });

        // Dropped IMMEDIATELY — the incoming fade-out owns the screen — even
        // though the new transition's own cover has not risen yet.
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();

        await tickMs(16); // the entering-scene cover rises
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('an occluded fallback never stamps the clock — releasing the occlusion resurrects nothing', async () => {
        // The arming conjunct, not just the display one: under the occluded
        // route cover the fallback rises and its chunk resolves; if that rise
        // stamped the latch, dropping the occlusion inside the phantom minimum
        // would surface a stale code cover over an already-revealed screen.
        const { Screen, resolve } = makeControlledScreen('resolved-screen');
        const registry = heldRegistry({ playfield: Screen });

        const { rerender } = renderRouter(makeSnapshot(), registry, {
            sceneCoverOccluded: true,
        });
        await tickMs(0);
        await tickMs(100);
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(0); // chunk resolved at T=100, still occluded

        await act(async () => {
            rerender(wrapRouter(makeSnapshot(), registry, { sceneCoverOccluded: false }));
            await Promise.resolve();
        });

        expect(screen.getByTestId('resolved-screen')).toBeTruthy();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
        await tickMs(50);
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('a second wait in the same mount gets its own full minimum', async () => {
        const first = makeControlledScreen('first-screen');
        const second = makeControlledScreen('second-screen');
        const registry = heldRegistry({
            playfield: first.Screen,
            screens: { 'tech-tree': second.Screen },
        });

        renderRouter(makeSnapshot(), registry, {});
        await tickMs(0); // wait 1 rises at T=0
        await tickMs(100);
        await act(async () => {
            first.resolve();
            await Promise.resolve();
        });
        await tickMs(0);
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(300); // T=400: wait 1 fully released
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();

        await tickMs(100); // T=500
        act(() => {
            useUiStore.getState().navigateToScreen('tech-tree');
        });
        await tickMs(0); // wait 2 rises at T=500
        await tickMs(50);
        await act(async () => {
            second.resolve();
            await Promise.resolve();
        });
        await tickMs(0); // resolved at T=550

        // Wait 2's release lands at ITS rise + minimum (500 + 400 = 900) — a
        // stale epoch from wait 1 would shrink it to nothing.
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(349); // T=899
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(1); // T=900
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it("a superseding transition's cover keeps its own full minimum", async () => {
        // The supersession drops the OLD held layer immediately; it must not
        // also bill the NEW wait for the old one's elapsed time — a cover
        // rising just before the old release would land gets an
        // approaching-zero floor, the exact flash the minimum exists to stop.
        const { Screen, resolve } = makeControlledScreen('resolved-screen');
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const assetManifest = stubManifest([ref]);
        const registry = heldRegistry({ playfield: Screen });
        const options = { assetManager, assetManifest };

        const { rerender } = renderRouter(makeSnapshot(), registry, options);
        await tickMs(0); // wait 1 rises at T=0
        await tickMs(100);
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(50); // T=150: wait 1's held layer standing

        await act(async () => {
            rerender(wrapRouter(makeTransitioningSnapshot([ref]), registry, options));
            await Promise.resolve();
        });
        await tickMs(16); // T=166: the superseding cover rises
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await tickMs(34); // T=200
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        // Release lands at the NEW rise + minimum (166 + 400 = 566), from both
        // sides — never at the old wait's remainder.
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(365); // T=565
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(1); // T=566
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('the commit-time chunk suspend chains onto the transition cover’s clock', async () => {
        const { Screen: EnteringScreen, resolve } = makeControlledScreen('entering-screen');
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const assetManifest = stubManifest([ref]);
        const registry = heldRegistry({
            screens: { summary: EnteringScreen },
        });
        const options = { assetManager, assetManifest };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16); // preload cover rises at T=16
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await tickMs(84); // T=100
        await act(async () => {
            rerender(
                wrapRouter(
                    makeSnapshot({
                        tick: 5,
                        sceneId: makeSceneId('engine:post-game'),
                        sceneTransition: null,
                        ...({ sceneDefaultScreen: 'summary' } as Partial<PlayerSnapshot>),
                    }),
                    registry,
                    options,
                ),
            );
            await Promise.resolve();
        });
        await tickMs(0);

        // The entering screen's chunk is cold: the Suspense fallback covers,
        // alone — the held layer must NOT double it.
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
        expect(screen.getAllByTestId('reporting-cover')).toHaveLength(1);

        await tickMs(100); // T=200
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(0);

        // One wait, one clock: the release lands at T=416 (the transition
        // cover's rise + minimum), NOT 200 + minimum.
        expect(screen.getByTestId('entering-screen')).toBeTruthy();
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        expect(screen.getAllByTestId('reporting-cover')).toHaveLength(1);

        await tickMs(215); // T=415
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(1); // T=416
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it.each([
        ['the engine placeholder', {}],
        ["the per-key 'none' opt-out", { loadingScreens: { summary: 'none' } }],
    ])('holds nothing when the cascade resolves %s', async (_name, overrides) => {
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const assetManifest = stubManifest([ref]);
        const registry: GameScreenRegistry = {
            ...plainRegistry(),
            loadingScreenMinVisibleMs: MIN_VISIBLE_MS,
            sceneDefaultScreens: { 'engine:post-game': 'summary' },
            ...(overrides as Partial<GameScreenRegistry>),
        };
        const options = { assetManager, assetManifest };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await tickMs(84);
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('renders byte-identically to today under the e2e env collapse', async () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const assetManifest = stubManifest([ref]);
        const registry = heldRegistry();
        const options = { assetManager, assetManifest };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await tickMs(84);
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });
});
