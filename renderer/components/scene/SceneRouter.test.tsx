// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    GameLoadingScreenProps,
    GameScreenProps,
    GameScreenRegistry,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
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

        renderRouter(snapshot, makeRegistry(), 1_000);

        expect(await screen.findByTestId('transition-overlay')).toBeTruthy();
        expect(screen.getByTestId('transition-overlay').getAttribute('data-fade-phase')).toBe(
            'fade-out',
        );
    });
});

function renderRouter(
    snapshot: PlayerSnapshot,
    registry: GameScreenRegistry,
    fadeDurationMs = 1,
): ReturnType<typeof render> {
    return render(wrapRouter(snapshot, registry, fadeDurationMs));
}

function wrapRouter(
    snapshot: PlayerSnapshot,
    registry: GameScreenRegistry,
    fadeDurationMs = 1,
): React.ReactElement {
    return (
        <FadeProvider>
            <SceneRouter
                registry={registry}
                snapshot={snapshot}
                localPlayerId={LOCAL_PLAYER}
                sendAction={vi.fn()}
                fadeOutMs={fadeDurationMs}
                fadeInMs={fadeDurationMs}
            />
        </FadeProvider>
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
