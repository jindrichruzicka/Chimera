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
import { FadeContext, FadeProvider, type FadeControl } from '../shell/FadeContext.js';
import { DEFAULT_LOADING_BEAT_FLOOR_MS } from './loadingCoverHold.js';
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

    // ── What a game overlay can actually OBSERVE ─────────────────────────────
    //
    // The contract admits a set of states; these two cases measure the set the
    // render site can actually produce. Recorded from INSIDE the overlay's own
    // render rather than sampled off the DOM, because a state handed over for a
    // single commit is gone before any poll runs.
    //
    // `labelPreloadState` is the compile-time half: it is typed by the CONTRACT
    // and names exactly the two labels asserted below, so a contract admitting a
    // third state leaves its value unnarrowed and the `never` binding stops
    // compiling.
    it('hands a game overlay a fraction and nothing else across a measured run', async () => {
        const first = textureRef('arena');
        const second = textureRef('floor');
        const assetManager = createStubAssetManager({
            [String(first)]: 'deferred',
            [String(second)]: 'deferred',
        });
        const assetManifest = stubManifest([first, second]);
        const observed: PreloadStateLabel[] = [];
        const registry = {
            ...plainRegistry(),
            transitionOverlay: makeGameOverlay(observed),
        } satisfies GameScreenRegistry;

        const { rerender } = renderRouter(makeTransitioningSnapshot([first, second]), registry, {
            assetManager,
            assetManifest,
        });

        await waitFor(() => expect(assetManager.registered).toHaveLength(1));
        assetManager.settleDeferred(first);
        await waitFor(() => expect(readGameOverlayProgress()).toBe('0.5'));
        assetManager.settleDeferred(second);
        await waitFor(() => expect(readGameOverlayProgress()).toBe('1'));

        rerender(
            wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, {
                assetManager,
                assetManifest,
            }),
        );
        await waitFor(() => expect(readGameOverlayProgress()).toBe('absent'));

        // The wait above pins the state the run ENDS in; this pins the whole
        // run — two states across every render of it and no third one, so the
        // `null` the hook publishes to release its channel reaches the overlay
        // as a withheld prop rather than as a value.
        expect([...new Set(observed)].sort()).toEqual(['absent', 'fraction']);
    });

    it('hands a game overlay nothing at all across an unmeasured run', async () => {
        const observed: PreloadStateLabel[] = [];
        const registry = {
            ...plainRegistry(),
            transitionOverlay: makeGameOverlay(observed),
        } satisfies GameScreenRegistry;
        // A fade to WATCH, because a registry supplying an overlay mounts no
        // engine one — so `data-fade-phase`, the anchor the engine-side cases
        // wait on, is not on screen here. The run starts on the far side of this
        // call, so observing it is what keeps the assertion from passing
        // vacuously over a run that never began.
        const fade = watchableFade();

        // No manifest: the run measures nothing, so there is no fraction to
        // report at any point in it — and no separate way to say so either. The
        // no-op path still reports `1` internally; the hook's gate is what stops
        // it, and this is the seam that catches the gate going.
        renderRouter(makeTransitioningSnapshot([textureRef('arena')]), registry, {
            assetManager: createStubAssetManager(),
            fadeControl: fade,
        });

        await waitFor(() => expect(fade.fadeOut).toHaveBeenCalled());
        // One macrotask drains the preload step's whole microtask chain, which
        // runs in the same `.then()` as that call resolving.
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });

        expect([...new Set(observed)]).toEqual(['absent']);
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
    // is 130, this is 150), paints its OWN backdrop rather than borrowing
    // whatever happens to stand behind it, and — being a cover the contract
    // gives no way to dispatch from — never eats a click meant for underneath.
    it.each([
        // `fixed`, not `absolute`: the cover stands in for the whole screen, and
        // an absolute layer fills only its positioned ancestor.
        ['position', 'fixed'],
        ['inset', '0px'],
        ['zIndex', 'var(--ch-z-loading-hud)'],
        ['backgroundColor', 'var(--ch-color-scrim)'],
    ])('sets %s on the cover layer', async (property, value) => {
        const ref = textureRef('arena');
        // A DECLARED cover: the beat arms on the cascade resolving one, so a
        // registry declaring none raises no layer to measure. That is the same
        // rule the route entries follow — an empty placeholder held on screen
        // is a wait with no explanation.
        const registry: GameScreenRegistry = {
            ...plainRegistry(),
            loadingScreen: makeCover('layer-cover'),
        };

        renderRouter(makeTransitioningSnapshot([ref]), registry, {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        });

        const layer = await screen.findByTestId('scene-preload-cover');
        expect(layer.style[property as unknown as number]).toBe(value);
    });

    it('swallows clicks rather than letting them reach what it hides', async () => {
        // The opposite of the rule the layer this replaces carried. That one was
        // a glyph over a live scene, so a click aimed at what showed through it
        // had a real target. This one is opaque and now stands over a mounted,
        // committed scene for the whole closing leg — a click during the beat is
        // aimed at something the player cannot see.
        const ref = textureRef('arena');
        const registry: GameScreenRegistry = {
            ...plainRegistry(),
            loadingScreen: makeCover('layer-cover'),
        };

        renderRouter(makeTransitioningSnapshot([ref]), registry, {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        });

        const layer = await screen.findByTestId('scene-preload-cover');
        expect(layer.style.pointerEvents).toBe('');
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
 * ABSENT prop from a present one — a fraction and "no measured preload is
 * running" are the two states the contract gives an overlay.
 *
 * `observed` collects every state it is handed, in render order. The DOM
 * attribute alone cannot carry that: a value the router publishes for a single
 * commit — the hook's release at the transition's end is exactly that — is gone
 * before any poll of the rendered tree runs.
 */
function makeGameOverlay(
    observed: PreloadStateLabel[] = [],
): (props: TransitionOverlayProps) => React.ReactElement {
    return (props: TransitionOverlayProps): React.ReactElement => {
        observed.push(labelPreloadState(props.preloadProgress));
        return (
            <div
                data-testid="game-transition-overlay"
                data-preload-progress={
                    'preloadProgress' in props ? String(props.preloadProgress) : 'absent'
                }
            />
        );
    };
}

type PreloadStateLabel = 'fraction' | 'absent';

/**
 * Names the state an overlay was handed. Typed by the CONTRACT rather than by
 * what the router happens to pass, so the two labels are a claim about the type
 * as much as about the run: an arm this cannot name leaves `value` unnarrowed
 * at the `never` binding and fails to compile.
 */
function labelPreloadState(value: TransitionOverlayProps['preloadProgress']): PreloadStateLabel {
    if (typeof value === 'number') {
        return 'fraction';
    }
    if (value === undefined) {
        return 'absent';
    }
    const unreachable: never = value;
    return unreachable;
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
        readonly startedAtTick?: number;
    } = {},
): PlayerSnapshot {
    return makeSnapshot({
        tick: overrides.tick ?? 3,
        sceneTransition: {
            toSceneId: makeSceneId(overrides.toSceneId ?? 'engine:post-game'),
            phase: overrides.phase ?? 'preparing',
            startedAtTick: overrides.startedAtTick ?? 2,
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
    /**
     * A fade to watch instead of the provider's own.
     *
     * The reveal is the one thing a standing cover defers, and it is a
     * CALL — a fade that did not happen leaves no rendered trace, so a
     * case about withholding it has to read the control itself.
     */
    readonly fadeControl?: FadeControl;
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
    const fade = options.fadeControl;

    return (
        <I18nProvider>
            <AssetManagerContext.Provider value={options.assetManager ?? null}>
                <FadeShim control={fade}>
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
                </FadeShim>
            </AssetManagerContext.Provider>
        </I18nProvider>
    );
}

/** The real provider unless a case hands one in to watch. */
function FadeShim({
    control,
    children,
}: {
    readonly control: FadeControl | undefined;
    readonly children: React.ReactNode;
}): React.ReactElement {
    if (control === undefined) {
        return <FadeProvider>{children}</FadeProvider>;
    }
    return <FadeContext.Provider value={control}>{children}</FadeContext.Provider>;
}

/** A fade that records what it was asked to do and does none of it. */
function watchableFade(): FadeControl {
    const control: FadeControl = {
        phase: 'idle',
        // Already black: the router is entered mid-transition in these
        // cases, which is the state a scene swap actually reaches.
        opacity: 1,
        setPhase: vi.fn(),
        fadeOut: vi.fn().mockResolvedValue(undefined),
        fadeIn: vi.fn().mockResolvedValue(undefined),
        claim: () => ({
            isActive: true,
            fadeOut: (durationMs?: number) => control.fadeOut(durationMs),
            fadeIn: (durationMs?: number) => control.fadeIn(durationMs),
        }),
    };
    return control;
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

/**
 * Advance past a beat leg AND drain the effect-driven transitions chained
 * after its timer.
 *
 * The last leg's timer only reaches `revealing`; `revealed`, the activation
 * teardown and the return to `idle` are each an effect reacting to the phase
 * before it. One `advanceTimersByTimeAsync` batches those into a single flush,
 * so a case that advanced once would read the beat parked one hop short — an
 * artifact of the fake clock, not of the machine.
 */
async function settleBeat(ms: number): Promise<void> {
    await tickMs(ms);
    // A frame per remaining leg. Each leg arms its OWN timer from the effect
    // the previous leg's phase change ran, so one advance arms it rather than
    // firing it — and a zero advance cannot fire it at all.
    await tickMs(16);
    await tickMs(16);
    await tickMs(16);
}

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

        // ONE cover spans the whole wait now. It does not drop and get replaced
        // by a held copy at the commit — it simply stays, still resolved
        // against the ENTERING scene, still carrying its last measured
        // fraction. The copy existed because the commit render could no longer
        // compute the resolution; the beat holds the hop it resolved once, so
        // there is nothing left to copy.
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
        const live = screen.getByTestId('scene-preload-cover');
        const liveCover = within(live).getByTestId('reporting-cover');
        expect(liveCover.dataset['progress']).toBe('0.5');
        expect(liveCover.dataset['reason']).toBe('assets');
        expect(liveCover.dataset['screenKey']).toBe('summary');

        // The transition lifecycle beneath is NOT deferred — the ack fired at
        // the fade-out and the snapshot carries no transition any more. What
        // the overlay still paints is the CURTAIN, at full opacity, for the
        // whole time the cover stands: it is the only painter in this provider,
        // so the black the cover sits on is this element, and the reveal that
        // follows has something to animate.
        await tickMs(299); // T=399, inside the floor measured from full visibility
        expect(screen.getByTestId('transition-overlay').style.opacity).toBe('1');
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        // Past the floor AND its closing leg. The cover now ramps out against
        // the curtain rather than cutting in the commit's own flush, which is
        // the rhythm that made this site differ from a route entry.
        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('drops the transition cover after the commit when the minimum has already elapsed', async () => {
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const assetManifest = stubManifest([ref]);
        const registry = heldRegistry();
        const options = { assetManager, assetManifest };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await tickMs(MIN_VISIBLE_MS + 100);
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        // AFTER, not WITH. A spent floor no longer means the cover vanishes in
        // the commit's own flush — it ramps out over `fadeMs` against the
        // curtain, the same closing leg a route entry runs. That single-frame
        // cut was the last rhythm difference between the two sites.
        await settleBeat(0);
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

        const cover = screen.getByTestId('scene-preload-cover');
        expect(within(cover).getByRole('status')).toBeTruthy();
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

    it('floors a declared cover with the engine default when no minimum is declared', async () => {
        // An absent declaration arms the engine default here, the same floor
        // a route entry arms.
        //
        // Read 1 ms BELOW and 1 ms ABOVE it rather than by waiting it out: a
        // site that armed no floor drops the cover on the first tick, so a case
        // checking only the far side would pass against one.
        const { Screen, resolve } = makeControlledScreen('resolved-screen');
        const registry: GameScreenRegistry = {
            ...plainRegistry(),
            playfield: Screen,
            loadingScreen: makeFullReportingCover(),
        };

        renderRouter(makeSnapshot(), registry, {});
        await tickMs(0);

        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(0);

        // The chunk resolved immediately; the cover is held anyway.
        expect(screen.getByTestId('resolved-screen')).toBeTruthy();
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();

        await tickMs(DEFAULT_LOADING_BEAT_FLOOR_MS - 1);
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(1);
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it.each([
        ['a declared minimum this site must not round to the default', 1_200],
        ['a declared minimum shorter than the default', 120],
    ])('reads %s off the registry', async (_label, declared) => {
        // The discrimination the rest of this suite cannot make: its fixtures
        // declare 400 ms, which is numerically the engine default, so a router
        // that threw the declaration away and always took the default would
        // satisfy every one of them. Both values here are chosen to differ from
        // it — one longer, one shorter, so neither a floor nor a ceiling on the
        // default can pass — and each is read on BOTH sides of its own release.
        const { Screen, resolve } = makeControlledScreen('resolved-screen');
        const registry: GameScreenRegistry = {
            ...plainRegistry(),
            playfield: Screen,
            loadingScreen: makeFullReportingCover(),
            loadingScreenMinVisibleMs: declared,
        };

        renderRouter(makeSnapshot(), registry, {});
        await tickMs(0);
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(0);

        await tickMs(declared - 1);
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
        await tickMs(1);
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('honours a declared 0 as the opt-down, never rounding it up to the default', async () => {
        // `0` is the one declaration that must NOT reach the fallback: it is how
        // a game says "show the cover, but only for as long as the load runs".
        // Folding it in with the absent case is the mutant.
        const { Screen, resolve } = makeControlledScreen('resolved-screen');
        const registry: GameScreenRegistry = {
            ...plainRegistry(),
            playfield: Screen,
            loadingScreen: makeFullReportingCover(),
            loadingScreenMinVisibleMs: 0,
        };

        renderRouter(makeSnapshot(), registry, {});
        await tickMs(0);
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

    it('withholds the reveal while the held cover is still serving its minimum', async () => {
        // The defect this replaces: the fade came back the instant the
        // transition ended, so the incoming scene appeared UNDERNEATH a cover
        // that was still serving its minimum — the model beside the spinner.
        const ref = textureRef('arena');
        const fadeControl = watchableFade();
        const registry = heldRegistry();
        const options = {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
            fadeControl,
        };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });
        await tickMs(0);

        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();
        expect(fadeControl.fadeIn).not.toHaveBeenCalled();
    });

    it('reveals in the commit the held cover leaves, and only once', async () => {
        const ref = textureRef('arena');
        const fadeControl = watchableFade();
        const registry = heldRegistry();
        const options = {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
            fadeControl,
        };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16); // cover rises at T=16; release lands at T=16+MIN_VISIBLE_MS
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        await settleBeat(MIN_VISIBLE_MS * 2);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(fadeControl.fadeIn).toHaveBeenCalledTimes(1);

        // The debt is spent, not standing: nothing re-fires it later.
        await tickMs(MIN_VISIBLE_MS);
        expect(fadeControl.fadeIn).toHaveBeenCalledTimes(1);
    });

    it('holds the curtain through a chunk wait behind its OWN cover, never behind the fallback', async () => {
        // The layering, because it is what decides the behaviour. A mounted
        // fallback resolves through the same cascade as the hop's cover
        // (Invariant #88) but renders in the SCREEN SLOT — the preset is
        // `position: absolute` with no z-index, "a sibling inside the scene,
        // not a route-level layer" — while the curtain is `fixed` at
        // `--ch-z-scene-fade`. Deferring the reveal on a fallback ALONE would
        // paint the player black for the whole chunk wait.
        //
        // The hop does defer through that wait, because the chunk folds into
        // the beat's `settled` term exactly as it already does at `/game` and
        // `/replays/player`. What makes that safe is the layer, not the bound:
        // the beat's OWN cover stays mounted at `--ch-z-loading-hud`, above the
        // curtain, so a `React.lazy` chunk that never resolves — the one wait
        // Invariant #133 leaves unbounded — parks the player on the game's
        // declared loading screen rather than on black.
        const { Screen, resolve } = makeControlledScreen('summary-screen');
        const ref = textureRef('arena');
        const fadeControl = watchableFade();
        const registry = heldRegistry({
            playfield: Screen,
            sceneDefaultScreens: { 'engine:post-game': 'playfield' },
        });
        const options = {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
            fadeControl,
        };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16);

        // The transition cover, while it stands, IS above the curtain.
        expect(screen.getByTestId('scene-preload-cover').style.zIndex).toBe(
            'var(--ch-z-loading-hud)',
        );

        await act(async () => {
            rerender(
                wrapRouter(
                    makeSnapshot({
                        tick: 5,
                        sceneId: makeSceneId('engine:post-game'),
                        sceneTransition: null,
                    }),
                    registry,
                    options,
                ),
            );
            await Promise.resolve();
        });
        await tickMs(0);

        // The chunk is cold, so the screen is not there — and the ONE cover the
        // player is looking at is the hop's, above the curtain. Read as the
        // element's ancestry rather than its presence: the fallback would
        // render the same `reporting-cover` testid in the screen slot, and
        // "a cover is on screen" is true of both.
        expect(screen.queryByTestId('summary-screen')).toBeNull();
        const standingCover = screen.getByTestId('reporting-cover');
        const layer = standingCover.closest('[data-testid="scene-preload-cover"]');
        expect(layer).not.toBeNull();
        expect((layer as HTMLElement).style.zIndex).toBe('var(--ch-z-loading-hud)');
        // Deferred, not spent: the wait is not over while the chunk is in
        // flight, and revealing here would land the player on the fallback
        // instead of on the screen.
        expect(fadeControl.fadeIn).not.toHaveBeenCalled();

        // PAST THE FLOOR, chunk still cold. This is the assertion that reads
        // the chunk as part of the wait rather than beside it: before the floor
        // elapses the reveal is withheld either way, so a beat whose `settled`
        // ignored the chunk would satisfy the check above and only diverge
        // here. The floor answers how long a cover is held, never whether the
        // wait is over.
        await settleBeat(MIN_VISIBLE_MS * 2);
        expect(fadeControl.fadeIn).not.toHaveBeenCalled();
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        // The chunk resolves: the wait is finally over, and the reveal is paid
        // exactly once on the far side of the cover's closing leg.
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await settleBeat(MIN_VISIBLE_MS);

        expect(screen.getByTestId('summary-screen')).toBeTruthy();
        expect(fadeControl.fadeIn).toHaveBeenCalledTimes(1);
    });

    it('keeps the curtain painted at full opacity under the held cover, then lifts it', async () => {
        // The paint, not the call: a fade nobody renders reveals nothing. This
        // provider's only painter is `TransitionOverlay`, so the black the
        // cover sits on and the ramp that follows are both this element — with
        // the REAL fade, not a spy.
        const ref = textureRef('arena');
        const registry = heldRegistry();
        const options = {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16);
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });
        await tickMs(0);

        // Transition over, cover standing: fully black behind it. The SAME
        // cover that rose for the hop — it spans the wait rather than handing
        // over to a copy at the commit.
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();
        expect(screen.getByTestId('transition-overlay').style.opacity).toBe('1');

        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();

        // The cover left against that same black; the curtain lifts after it.
        await tickMs(64);
        expect(screen.queryByTestId('transition-overlay')).toBeNull();
        expect(screen.getByTestId('playfield-screen')).toBeTruthy();
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
        // latch that kept wait 1's rise stamp would shrink it to nothing.
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

        // The hop's own cover carries on past the commit — the supersession
        // handed the wait from the held layer to the beat, and the beat holds
        // one cover for the whole of it.
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        // Still standing at T=565, which is the measurement: the old wait rose
        // at T=0 and would have released at T=400, so a cover that billed the
        // NEW wait for the old one's elapsed time would already be gone here.
        await tickMs(365);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
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

        // The entering screen's chunk is cold, and the hop's own cover simply
        // carries on: the chunk folds into the beat's `settled` term rather
        // than becoming a second wait with a second cover. No hand-off happens
        // at all now, which is what "one wait" means here.
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
        // Exactly one, because the Suspense fallback is suppressed under a
        // standing hop cover. Two would be invisible — the hop layer paints
        // scrim above it — and still announce the same wait twice.
        expect(screen.getAllByTestId('reporting-cover')).toHaveLength(1);

        await tickMs(100);
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(0);

        // One wait, one clock: the chunk resolving does not restart anything,
        // and the cover is still the one that rose for the hop.
        expect(screen.getByTestId('entering-screen')).toBeTruthy();
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();
        expect(screen.getAllByTestId('reporting-cover')).toHaveLength(1);

        // Still standing at T=415 — the floor is measured from the hop's rise,
        // not from the chunk's resolution at T=200.
        await tickMs(215);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
    });

    it.each([
        ['the engine placeholder', {}],
        ["the per-key 'none' opt-out", { loadingScreens: { summary: 'none' } }],
    ])('raises nothing when the cascade resolves %s', async (_name, overrides) => {
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
        // NOTHING, where this site used to raise the layer with the engine's
        // empty placeholder inside and merely decline to HOLD it. The beat arms
        // on a cover the game chose to show, so the two sites now agree on
        // which waits are explained at all rather than only on how long for.
        // A declared minimum does not conjure one — the floor answers how long,
        // never whether.
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();

        await tickMs(84);
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('collapses the floor but not the sequence under the e2e env', async () => {
        // The flag zeroes `resolveLoadingBeatFloorMs`, and nothing else. The
        // beat still ARMS, still raises the declared cover and still leaves it
        // against the curtain — what goes is the deliberate delay, which is the
        // whole of what that flag is for (Invariant #133). A collapse that
        // skipped the sequence would make every e2e assertion about the cover
        // pass vacuously.
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

        // No floor left to serve, so the cover goes as soon as its legs run —
        // asserted after the legs rather than in the commit's own flush, which
        // is where the collapse differs from a skip.
        await settleBeat(0);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });
});

// ── The scene hop runs the loading beat (§4.36, Invariant #133) ───────────────
//
// The convergence: this site and the two route entries become
// ONE machine rather than two that happen to produce a compatible order. What
// separates them is not the order — it is which waits raise a cover at all.

describe('SceneRouter — the scene hop runs the loading beat', () => {
    /** A registry declaring a cover and a floor — what makes a beat happen at all. */
    function beatRegistry(overrides: Partial<GameScreenRegistry> = {}): GameScreenRegistry {
        return {
            ...plainRegistry(),
            loadingScreen: makeFullReportingCover(),
            loadingScreenMinVisibleMs: MIN_VISIBLE_MS,
            ...overrides,
        };
    }

    beforeEach(() => {
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

    it('raises the declared cover for a hop that measures nothing', async () => {
        // The divergence, stated as a case. `readEnteringScene` answered `null`
        // while `preloadProgress` was `null`, so a scene declaring no
        // `requiredAssets` — or a game shipping no manifest — hopped with no
        // cover at all, while the SAME registry entering through `/game` got
        // the full beat. The beat arms on a DECLARED cover, never on a measured
        // one: a wait that settles before anything could be counted is exactly
        // the wait a floor exists for.
        const registry: GameScreenRegistry = {
            ...plainRegistry(),
            loadingScreen: makeCover('declared-cover'),
            loadingScreenMinVisibleMs: MIN_VISIBLE_MS,
        };

        renderRouter(makeTransitioningSnapshot([]), registry, {
            assetManager: createStubAssetManager(),
        });

        await tickMs(16);

        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();
        expect(screen.getByTestId('declared-cover')).toBeTruthy();
    });

    it('never reveals between two hops when one supersedes another mid-beat', async () => {
        // The reveal is owed per TRANSITION, and a supersession means the first
        // one's scene is never the one the player should be shown. Revealing
        // between the two would flash the superseded scene for a frame and then
        // black it out again to run the second hop.
        const first = textureRef('arena');
        const fadeControl = watchableFade();
        const registry = beatRegistry();
        const options = {
            assetManager: createStubAssetManager({ [String(first)]: 'hang' }),
            assetManifest: stubManifest([first]),
            fadeControl,
        };

        const { rerender } = renderRouter(makeTransitioningSnapshot([first]), registry, options);
        await tickMs(16);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        // A SECOND hop arrives before the first has settled — a different
        // transition key, which is what makes it a different wait rather than
        // a re-render of the same one.
        await act(async () => {
            rerender(
                wrapRouter(
                    makeTransitioningSnapshot([first], { tick: 6, toSceneId: 'engine:menu' }),
                    registry,
                    options,
                ),
            );
            await Promise.resolve();
        });
        await settleBeat(MIN_VISIBLE_MS);

        // Nothing was revealed across the hand-off. Asserted as a COUNT of
        // zero rather than "the second cover is up": a reveal that fired and
        // was immediately re-covered leaves the same DOM behind. WHOSE floor
        // the second hop then stands on, and what the layer shows while it
        // waits, are the cases below.
        expect(fadeControl.fadeIn).not.toHaveBeenCalled();
    });

    // ── Supersession: whose floor does the second hop stand on? (§4.36) ───────
    //
    // The decision these cases pin: the floor is on the RAISE, not on the hop.

    it('stands a superseding hop on the floor the first hop already spent', async () => {
        // Re-arming per hop would make the covered window grow with host
        // churn: each supersession would push the reveal another whole floor
        // out, which is the "delay added to a slow load" the knob is
        // documented never to be.
        const fadeControl = watchableFade();
        const registry = beatRegistry();
        const options = { assetManager: createStubAssetManager(), fadeControl };

        const { rerender } = renderRouter(makeTransitioningSnapshot([]), registry, options);
        // Past the cover's fade-in leg, so the floor is stamped...
        await tickMs(16);
        // ...and then spent in full, while the first hop stays unsettled on
        // its still-pending transition.
        await tickMs(MIN_VISIBLE_MS);
        expect(fadeControl.fadeIn).not.toHaveBeenCalled();

        // A second hop — a different `toSceneId`, so a different wait — and
        // then its commit, which is what ends the wait.
        await act(async () => {
            rerender(
                wrapRouter(
                    makeTransitioningSnapshot([], { tick: 6, toSceneId: 'engine:menu' }),
                    registry,
                    options,
                ),
            );
            await Promise.resolve();
        });
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 7, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        // Only the closing leg is left to run. `settleBeat(0)` advances 48 ms
        // against a floor of MIN_VISIBLE_MS, so a beat that re-stamped on the
        // second hop is still holding its cover at this line.
        await settleBeat(0);
        expect(fadeControl.fadeIn).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
    });

    it('still owes the rest of that floor when the supersession lands early in it', async () => {
        // The other direction of the same rule, and the one an "a new target
        // clears the stamp" edit would break the other way: inheriting the
        // first hop's clock means inheriting what is LEFT of it, not skipping
        // it. Without this case, a beat that dropped the floor outright on a
        // target change would pass the case above.
        const fadeControl = watchableFade();
        const registry = beatRegistry();
        const options = { assetManager: createStubAssetManager(), fadeControl };

        const { rerender } = renderRouter(makeTransitioningSnapshot([]), registry, options);
        await tickMs(16);
        // A quarter of the floor spent, no more.
        await tickMs(100);

        await act(async () => {
            rerender(
                wrapRouter(
                    makeTransitioningSnapshot([], { tick: 6, toSceneId: 'engine:menu' }),
                    registry,
                    options,
                ),
            );
            await Promise.resolve();
        });
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 7, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        // Settled, and still covered: the first hop's remainder is what the
        // second one is waiting out.
        await settleBeat(0);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();
        expect(fadeControl.fadeIn).not.toHaveBeenCalled();

        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(fadeControl.fadeIn).toHaveBeenCalledTimes(1);
    });

    it('swaps the standing cover to the superseding hop’s declared form in place', async () => {
        // What the layer RENDERS across the hand-off. The cover resolves the
        // entering scene's key, so a supersession changes what it shows — and
        // it has to change it without the layer going anywhere, since the
        // curtain behind it is what the player would see instead.
        const fadeControl = watchableFade();
        const registry = beatRegistry({
            loadingScreens: {
                alpha: makeCover('cover-alpha'),
                beta: makeCover('cover-beta'),
            },
        });
        const options = { assetManager: createStubAssetManager(), fadeControl };

        const { rerender } = renderRouter(
            makeTransitioningSnapshot([], { defaultScreen: 'alpha' }),
            registry,
            options,
        );
        await tickMs(16);
        const raised = screen.getByTestId('scene-preload-cover');
        expect(within(raised).getByTestId('cover-alpha')).toBeTruthy();
        expect(raised.style.opacity).toBe('1');

        await act(async () => {
            rerender(
                wrapRouter(
                    makeTransitioningSnapshot([], {
                        tick: 6,
                        toSceneId: 'engine:menu',
                        defaultScreen: 'beta',
                    }),
                    registry,
                    options,
                ),
            );
            await Promise.resolve();
        });

        // Read on the commit the supersession itself produced, not after a
        // frame: a layer torn down and re-raised is either absent here or back
        // at opacity 0 waiting for its ramp, and correct again one frame later.
        const swapped = screen.getByTestId('scene-preload-cover');
        expect(swapped).toBe(raised);
        expect(swapped.style.opacity).toBe('1');
        expect(within(swapped).getByTestId('cover-beta')).toBeTruthy();
        expect(screen.queryByTestId('cover-alpha')).toBeNull();
    });

    it('keeps the layer standing for a superseding hop whose cascade declares none', async () => {
        // The awkward form, decided rather than left unmeasured: the second
        // hop's key resolves the `'none'` opt-out, so the layer renders the
        // engine's empty placeholder for the rest of the floor. It is NOT
        // dropped — the curtain it would uncover is opaque for that whole
        // window anyway, so dropping it buys nothing and costs the one thing
        // the beat exists to remove, a layer changing mid-wait.
        const fadeControl = watchableFade();
        const registry = beatRegistry({ loadingScreens: { bare: 'none' } });
        const options = { assetManager: createStubAssetManager(), fadeControl };

        const { rerender } = renderRouter(makeTransitioningSnapshot([]), registry, options);
        await tickMs(16);
        expect(
            within(screen.getByTestId('scene-preload-cover')).getByTestId('reporting-cover'),
        ).toBeTruthy();

        await act(async () => {
            rerender(
                wrapRouter(
                    makeTransitioningSnapshot([], {
                        tick: 6,
                        toSceneId: 'engine:menu',
                        defaultScreen: 'bare',
                    }),
                    registry,
                    options,
                ),
            );
            await Promise.resolve();
        });

        const standing = screen.getByTestId('scene-preload-cover');
        expect(standing.style.opacity).toBe('1');
        expect(standing.style.backgroundColor).toBe('var(--ch-color-scrim)');
        // The engine placeholder, and it is empty — the scrim is the whole of
        // what shows.
        expect(within(standing).getByTestId('scene-screen-loading').childElementCount).toBe(0);
        expect(screen.queryByTestId('reporting-cover')).toBeNull();

        // And it leaves on the first hop's clock like any other supersession.
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 7, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });
        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
    });

    it('gives a declared hop its own whole floor when the hop it supersedes raised nothing', async () => {
        // The rule stated as "the floor is on the RAISE" only holds if an
        // undeclared hop raises nothing to inherit. It parks the beat at
        // `covered` with the curtain black and no cover, so the first — and
        // only — raise of the sequence is the second hop's, and it earns the
        // whole minimum rather than a remainder of a floor nobody served.
        const fadeControl = watchableFade();
        const registry = beatRegistry({ loadingScreens: { bare: 'none' } });
        const options = { assetManager: createStubAssetManager(), fadeControl };

        const { rerender } = renderRouter(
            makeTransitioningSnapshot([], { defaultScreen: 'bare' }),
            registry,
            options,
        );
        await tickMs(16);
        await tickMs(MIN_VISIBLE_MS);
        // Nothing was raised, so nothing was floored.
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();

        await act(async () => {
            rerender(
                wrapRouter(
                    makeTransitioningSnapshot([], { tick: 6, toSceneId: 'engine:menu' }),
                    registry,
                    options,
                ),
            );
            await Promise.resolve();
        });
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 7, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });

        // Settled now, and still covered 48 ms later: this hop's cover is
        // serving a whole floor of its own, not a spent remainder.
        await settleBeat(0);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();
        expect(fadeControl.fadeIn).not.toHaveBeenCalled();

        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(fadeControl.fadeIn).toHaveBeenCalledTimes(1);
    });

    it('reveals a hop that raises no cover even while a chunk is still cold', async () => {
        // The chunk may only EXTEND a wait the player can see something during.
        // A registry declaring no cover form raises no layer here, so folding a
        // cold `React.lazy` chunk into the wait would hold the curtain at full
        // opacity over nothing — released only by the module import, the one
        // wait Invariant #133 leaves unbounded. The layer is what makes the
        // deferral safe, so where there is no layer there is no deferral.
        const { Screen } = makeControlledScreen('cold-screen');
        const fadeControl = watchableFade();
        // No `loadingScreen`: the cascade resolves the engine placeholder, so
        // the beat arms nothing.
        const registry: GameScreenRegistry = {
            ...plainRegistry(),
            playfield: Screen,
            loadingScreenMinVisibleMs: MIN_VISIBLE_MS,
        };
        const options = {
            assetManager: createStubAssetManager(),
            fadeControl,
        };

        const { rerender } = renderRouter(makeTransitioningSnapshot([]), registry, options);
        await tickMs(16);
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });
        await settleBeat(MIN_VISIBLE_MS);

        // The chunk is STILL cold — `resolve()` is never called — and the
        // reveal has been paid anyway.
        expect(screen.queryByTestId('cold-screen')).toBeNull();
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(fadeControl.fadeIn).toHaveBeenCalledTimes(1);
    });

    it('keeps the cover up past the floor while the host has not yet committed', async () => {
        // The commit is half of the wait, and the half no other case reads:
        // every "past the floor" assertion elsewhere is taken AFTER the
        // rerender that ends the transition. A beat whose `settled` dropped the
        // pending-transition term would drop the cover once the floor elapsed
        // and leave the player on bare black for the rest of the preload.
        const ref = textureRef('arena');
        const registry = beatRegistry();
        const options = {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        };

        renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        await tickMs(16);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        // No commit rerender at all — the snapshot still carries the
        // transition, and the preload never settles.
        await settleBeat(MIN_VISIBLE_MS * 2);

        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();
    });

    it('raises no held copy while a hop owns the screen', async () => {
        // The held layer serves the screen switch; a hop has its own cover and
        // its own clock. What keeps a copy from rising here is the residue
        // clear on the hop's arrival plus the fallbackMounted wall — see
        // `drops pre-hop held residue for good` for the post-commit window.
        const { Screen, resolve } = makeControlledScreen('switch-screen');
        const ref = textureRef('arena');
        const registry = beatRegistry({ playfield: Screen });
        const options = {
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
        };

        // A code wait first, so a held copy exists to be re-raised.
        const { rerender } = renderRouter(makeSnapshot(), registry, options);
        await tickMs(0);
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(50);

        // Now a hop arrives and owns the screen through its whole beat.
        await act(async () => {
            rerender(wrapRouter(makeTransitioningSnapshot([ref]), registry, options));
            await Promise.resolve();
        });
        await tickMs(16);

        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('ramps the cover out against the curtain instead of cutting it', async () => {
        // The rhythm difference this convergence removes. The hand-rolled layer
        // this replaces declared no `opacity` and no `transition`, so its
        // `loading-out` leg was byte-identical to `loading` and the cover cut at
        // unmount — a delayed cut, not a leg. Read as the DECLARATION plus the
        // commanded value, because a ramp nobody declared animates nothing.
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const registry = beatRegistry();
        const options = { assetManager, assetManifest: stubManifest([ref]), fadeDurationMs: 40 };

        const { rerender } = renderRouter(makeTransitioningSnapshot([ref]), registry, options);
        // Past the fade-out and the cover's mount, plus the extra frames: the
        // cover starts DOWN so the browser has a value to animate from, and
        // raises on a frame armed during the advance — which a single advance
        // arms rather than fires, the same artifact `settleBeat` absorbs.
        await tickMs(160);
        await tickMs(16);
        await tickMs(16);

        const covering = screen.getByTestId('scene-preload-cover');
        expect(covering.style.transition).toContain('opacity');
        expect(covering.style.opacity).toBe('1');

        // Settle the wait so the beat leaves `loading` for its closing leg.
        await act(async () => {
            assetManager.settleDeferred(ref);
            await Promise.resolve();
        });
        await act(async () => {
            rerender(
                wrapRouter(makeSnapshot({ tick: 5, sceneTransition: null }), registry, options),
            );
            await Promise.resolve();
        });
        await tickMs(MIN_VISIBLE_MS + 16);

        // Still MOUNTED, and driven to 0 — the leg the old shape did not run.
        const leaving = screen.getByTestId('scene-preload-cover');
        expect(leaving.style.opacity).toBe('0');
        expect(leaving.style.transition).toContain('opacity');
    });

    it('treats a re-entry to the SAME scene as a new wait with no inherited fraction', async () => {
        // `toSceneId` alone cannot separate these two waits — it is the same
        // string for both. `startedAtTick` is what makes the second hop its
        // own, and the fraction channel has to agree: the first hop ended at 1,
        // and a second hop with NOTHING to measure reports no number of its
        // own, so whatever its cover shows is inherited. It must show none.
        const first = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(first)]: 'deferred' });
        const registry = beatRegistry({
            sceneDefaultScreens: { 'engine:post-game': 'summary' },
        });
        const options = { assetManager, assetManifest: stubManifest([first]) };

        const { rerender } = renderRouter(
            makeTransitioningSnapshot([first], { startedAtTick: 2 }),
            registry,
            options,
        );
        await tickMs(16);
        await act(async () => {
            assetManager.settleDeferred(first);
            await Promise.resolve();
        });
        await tickMs(0);
        expect(screen.getByTestId('reporting-cover').dataset['progress']).toBe('1');

        // The SAME scene again, one tick later, with nothing to preload.
        await act(async () => {
            rerender(
                wrapRouter(
                    makeTransitioningSnapshot([], { tick: 6, startedAtTick: 5 }),
                    registry,
                    options,
                ),
            );
            await Promise.resolve();
        });
        await tickMs(16);

        expect(screen.getByTestId('reporting-cover').dataset['progress']).toBe('null');
    });

    it('never re-raises a held cover after the reveal for a chunk nobody saw', async () => {
        // The suppressed fallback must not arm the minimum-VISIBLE hold: while
        // the hop's cover stands, nobody saw the fallback, so there is nothing
        // whose visibility a floor could protect. Armed anyway, the latch
        // outlives the hop — its minimum runs from the chunk's MOUNT — and the
        // held copy rises OVER the revealed scene for the remainder: a loading
        // screen flashing up after the player is already looking at the board.
        //
        // The commit is deliberately LATE relative to the cover's rise, which
        // widens the window between the beat's reveal and the latch's release;
        // asserted INSIDE that window, because the flash is transient and an
        // end-state read steps straight over it.
        const { Screen: EnteringScreen, resolve } = makeControlledScreen('entering-screen');
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'deferred' });
        const registry = beatRegistry({ screens: { summary: EnteringScreen } });
        const options = { assetManager, assetManifest: stubManifest([ref]) };

        const { rerender } = renderRouter(
            makeTransitioningSnapshot([ref], { defaultScreen: 'summary' }),
            registry,
            options,
        );
        await tickMs(16);
        await act(async () => {
            assetManager.settleDeferred(ref);
            await Promise.resolve();
        });

        // Hold the transition open until T≈300: the floor has been running
        // since the cover rose at T≈17, so the beat ends well before a latch
        // armed at the commit would release.
        await tickMs(268);
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
        await tickMs(16);
        await act(async () => {
            resolve();
            await Promise.resolve();
        });

        // Into the window: the beat has revealed and released the hop, and a
        // latch armed at the chunk's mount would still be serving its
        // remainder for another ~250 ms.
        await settleBeat(120);
        expect(screen.getByTestId('entering-screen')).toBeTruthy();
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();

        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('drops pre-hop held residue for good — the old cover never re-raises after the hop', async () => {
        // A hop is a NEW wait: whatever a pre-hop code wait left standing — the
        // latch still serving its minimum, the held copy's content — is not the
        // hop's to resurrect. Without clearing it, the latch outlives the hop
        // and the OLD screen's cover rises over the NEWLY revealed scene for
        // the old wait's remainder. The hop here resolves an undeclared cover
        // ('none' for the entering key), so it reveals at the commit and the
        // window between its release and the stale latch's is wide open.
        const { Screen, resolve } = makeControlledScreen('old-screen');
        const registry = beatRegistry({
            playfield: Screen,
            loadingScreens: { summary: 'none' },
            sceneDefaultScreens: { 'engine:post-game': 'summary' },
        });
        const options = { assetManager: createStubAssetManager() };

        // The pre-hop code wait: cover up, then the chunk resolves inside the
        // minimum, leaving the copy standing on a latch with ~350ms to serve.
        const { rerender } = renderRouter(makeSnapshot(), registry, options);
        await tickMs(0);
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await tickMs(50);
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();

        // The hop arrives and commits while that latch is still running.
        await act(async () => {
            rerender(wrapRouter(makeTransitioningSnapshot([]), registry, options));
            await Promise.resolve();
        });
        await tickMs(16);
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

        // Inside the stale latch's remainder, after the hop has revealed and
        // released: the old cover must not be back.
        await settleBeat(64);
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
        await settleBeat(MIN_VISIBLE_MS);
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });

    it('defaults every leg through screenFadeMs, so an unpinned page collapses under the e2e flag', async () => {
        // The replay player passes no fade props at all, so THIS default is the
        // only thing standing between its hops and 200ms legs inside an e2e
        // build. Rendered without fade props on purpose; the beat completing on
        // effect flushes alone — no leg-sized timer ever advanced — is what
        // separates a collapsed default from a hardcoded one.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        const registry = beatRegistry();

        const { rerender } = render(
            <I18nProvider>
                <AssetManagerContext.Provider value={createStubAssetManager()}>
                    <FadeProvider>
                        <SceneRouter
                            registry={registry}
                            snapshot={makeTransitioningSnapshot([])}
                            localPlayerId={LOCAL_PLAYER}
                            sendAction={vi.fn()}
                        />
                    </FadeProvider>
                </AssetManagerContext.Provider>
            </I18nProvider>,
        );
        // The fade-out is the hook's own 300ms default here — the e2e flag
        // collapses the BEAT's durations, not the ack's fade — so the curtain
        // needs its frames before the cover can rise.
        await settleBeat(320);
        expect(screen.getByTestId('scene-preload-cover')).toBeTruthy();

        await act(async () => {
            rerender(
                <I18nProvider>
                    <AssetManagerContext.Provider value={createStubAssetManager()}>
                        <FadeProvider>
                            <SceneRouter
                                registry={registry}
                                snapshot={makeSnapshot({ tick: 5, sceneTransition: null })}
                                localPlayerId={LOCAL_PLAYER}
                                sendAction={vi.fn()}
                            />
                        </FadeProvider>
                    </AssetManagerContext.Provider>
                </I18nProvider>,
            );
            await Promise.resolve();
        });

        // Floor 0 and legs 0: nothing but flushes between the commit and the
        // cover's exit. tickMs(0) fires no leg-sized timer, so a 200ms (or any
        // hardcoded) default parks the cover here and reds.
        await tickMs(0);
        await tickMs(0);
        await tickMs(0);
        await tickMs(0);
        expect(screen.queryByTestId('scene-preload-cover')).toBeNull();
    });

    it('holds the ack where it was, whatever the floor', async () => {
        // Invariant #133 at the seam the beat and the floor actually meet.
        // `useFadeTransition.test.tsx` pins the ack against cover regimes it is
        // handed; here the floor is the real resolver's, so a mutant that let
        // it reach the dispatch has somewhere to bite.
        const ackTicks = async (minVisibleMs: number): Promise<unknown[]> => {
            const sent: unknown[] = [];
            // Nothing to preload, so the ack turns on the fade-out alone —
            // the leg whose timing the floor must not touch.
            const registry = beatRegistry({ loadingScreenMinVisibleMs: minVisibleMs });
            render(
                <I18nProvider>
                    <AssetManagerContext.Provider value={createStubAssetManager()}>
                        <FadeProvider>
                            <SceneRouter
                                registry={registry}
                                snapshot={makeTransitioningSnapshot([])}
                                localPlayerId={LOCAL_PLAYER}
                                sendAction={(action) => sent.push(action)}
                                fadeOutMs={1}
                                fadeInMs={1}
                            />
                        </FadeProvider>
                    </AssetManagerContext.Provider>
                </I18nProvider>,
            );
            await tickMs(64);
            cleanup();
            return sent;
        };

        const noFloor = await ackTicks(0);
        const longFloor = await ackTicks(10_000);

        expect(noFloor).toEqual([
            {
                type: 'engine:scene_ready',
                playerId: LOCAL_PLAYER,
                tick: 3,
                payload: { playerId: LOCAL_PLAYER },
            },
        ]);
        expect(longFloor).toEqual(noFloor);
    });
});
