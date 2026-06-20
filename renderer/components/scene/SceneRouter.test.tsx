// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gamePhase, playerId, type PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import type {
    GameScreenProps,
    GameScreenRegistry,
} from '@chimera/simulation/foundation/game-screen-contract.js';
import { TacticsGameScreenRegistry } from '@chimera/tactics/screens/index.js';
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
    it('renders the board slot for the active scene by default', async () => {
        renderRouter(makeSnapshot(), makeRegistry());

        expect(await screen.findByTestId('board-screen')).toBeTruthy();
    });

    it('renders a named screen selected through uiStore without IPC', async () => {
        useUiStore.getState().setActiveSceneId('engine:game');
        useUiStore.getState().navigateToScreen('tech-tree');

        renderRouter(makeSnapshot(), makeRegistry());

        expect(await screen.findByTestId('tech-tree-screen')).toBeTruthy();
        expect(screen.queryByTestId('board-screen')).toBeNull();
    });

    it('resets named screen navigation to board when sceneId changes', async () => {
        useUiStore.getState().setActiveSceneId('engine:game');
        useUiStore.getState().navigateToScreen('tech-tree');
        const registry = makeRegistry();

        const { rerender } = renderRouter(
            makeSnapshot({ sceneId: makeSceneId('engine:game') }),
            registry,
        );
        expect(await screen.findByTestId('tech-tree-screen')).toBeTruthy();

        rerender(wrapRouter(makeSnapshot({ sceneId: makeSceneId('engine:post-game') }), registry));

        await waitFor(() => expect(screen.getByTestId('board-screen')).toBeTruthy());
        expect(useUiStore.getState().activeScreenKey).toBe('board');
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
                'engine:post-game': 'board',
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

    it('post-game sceneDefaultScreen from simulation matches tactics registry override', () => {
        // Consistency guard: DefaultScenes registers engine:post-game with defaultScreen 'summary'.
        // TacticsGameScreenRegistry must also map engine:post-game to 'summary' so simulation
        // and renderer agree — preventing scene/UI divergence (WARN-1).
        // NOTE: see games/tactics/screens/index.test.tsx for a
        // cross-package assertion that does not depend on the jsdom environment.
        const tacticsPostGame = TacticsGameScreenRegistry.sceneDefaultScreens?.['engine:post-game'];
        expect(tacticsPostGame).toBe('summary');
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

function makeRegistry(): GameScreenRegistry {
    const Board = makeScreen('board-screen');
    const TechTree = makeScreen('tech-tree-screen');

    return {
        board: Board,
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
