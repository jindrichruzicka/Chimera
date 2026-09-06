// @vitest-environment jsdom
// renderer/components/scene/SceneRouter.memo.test.tsx
//
// What a router re-render costs the game screen.
//
// The router re-renders for plenty of reasons the screen does not read — a
// preload fraction, a Suspense fallback mounting, an outer cover flag. This
// file pins that those stop at the router.

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    GameScreenProps,
    GameScreenRegistry,
    SendAction,
    TransitionOverlayProps,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import { useUiStore } from '../../state/uiStore.js';
import { FadeProvider } from '../shell/FadeContext.js';
import { SceneRouter } from './SceneRouter.js';

const LOCAL_PLAYER = playerId('local-player');

/** Stable for the life of the file: an unstable callback would defeat any memo. */
const SEND_ACTION: SendAction = vi.fn();

let screenRenders = 0;
let screenMounts = 0;
let routerRenders = 0;

function CountingPlayfield({ snapshot }: GameScreenProps): React.ReactElement {
    screenRenders += 1;
    React.useEffect(() => {
        screenMounts += 1;
    }, []);
    return <div data-testid="playfield-screen" data-tick={snapshot.tick} />;
}

/**
 * The router's OWN render counter.
 *
 * The registry overlay is rendered from a freshly built element on every router
 * render and is deliberately NOT memoised — the router hands it a live preload
 * fraction — so its render count is the router's, not the screen's. Counting
 * the screen instead would be a strictly weaker claim: the screen has a memo of
 * its own and would sit still through a router that re-ran everything.
 */
function CountingOverlay(_props: TransitionOverlayProps): React.ReactElement {
    routerRenders += 1;
    return <div data-testid="overlay" />;
}

let namedScreenRenders = 0;
let namedScreenMounts = 0;

/**
 * A registry screen reached through `screens[key]` rather than `playfield`.
 *
 * `resolveScreen` has two forks and they memoise separately: a tech tree, a
 * detail panel or a post-game summary all arrive through this one, and a fix
 * applied to the playfield fork alone would leave them re-rendering.
 */
function CountingTechTree({ snapshot }: GameScreenProps): React.ReactElement {
    namedScreenRenders += 1;
    React.useEffect(() => {
        namedScreenMounts += 1;
    }, []);
    return <div data-testid="tech-tree-screen" data-tick={snapshot.tick} />;
}

const registry: GameScreenRegistry = {
    playfield: CountingPlayfield,
    screens: { 'tech-tree': CountingTechTree },
    transitionOverlay: CountingOverlay,
};

function wrap(snapshot: PlayerSnapshot, sceneCoverOccluded: boolean): React.ReactElement {
    return (
        <I18nProvider>
            <FadeProvider>
                <SceneRouter
                    registry={registry}
                    snapshot={snapshot}
                    localPlayerId={LOCAL_PLAYER}
                    sendAction={SEND_ACTION}
                    sceneCoverOccluded={sceneCoverOccluded}
                />
            </FadeProvider>
        </I18nProvider>
    );
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

beforeEach(() => {
    screenRenders = 0;
    screenMounts = 0;
    namedScreenRenders = 0;
    namedScreenMounts = 0;
    routerRenders = 0;
    useUiStore.getState().resetScreenNavigation();
});

afterEach(() => {
    cleanup();
});

describe('SceneRouter — what a router re-render costs the screen', () => {
    it('does not re-run the ROUTER when a parent re-renders it with unchanged props', async () => {
        // The router's own bail-out, distinct from the screen's: it is what
        // keeps the fade machine, the loading beat and the screen-key cascade
        // from re-running when a parent re-renders for its own reasons. Every
        // prop below is the same value, not merely an equal one.
        const snapshot = makeSnapshot();
        const { rerender } = render(wrap(snapshot, false));
        await screen.findByTestId('overlay');
        const rendersAtRest = routerRenders;

        rerender(wrap(snapshot, false));
        rerender(wrap(snapshot, false));

        expect(routerRenders).toBe(rendersAtRest);
    });

    it('does not re-render the game screen for a prop the screen never reads', async () => {
        const snapshot = makeSnapshot();
        const { rerender } = render(wrap(snapshot, false));
        await screen.findByTestId('playfield-screen');
        const rendersAtRest = screenRenders;

        // `sceneCoverOccluded` is the router's own business — it reaches no
        // screen prop. The SAME snapshot object, so nothing the screen reads
        // has moved.
        rerender(wrap(snapshot, true));
        rerender(wrap(snapshot, false));

        expect(screenRenders).toBe(rendersAtRest);
    });

    it('does not REMOUNT the game screen across router re-renders', async () => {
        // The memo wrapper is the element's TYPE. Rebuilt per render it would
        // be a new type each time, and React would tear the screen down and
        // stand a fresh one up — losing its state and re-running its effects
        // on a router re-render that changed nothing.
        const snapshot = makeSnapshot();
        const { rerender } = render(wrap(snapshot, false));
        await screen.findByTestId('playfield-screen');

        rerender(wrap(snapshot, true));
        rerender(wrap(makeSnapshot({ tick: 4 }), true));

        expect(screenMounts).toBe(1);
    });

    it('gives a NAMED registry screen the same bail-out as the playfield', async () => {
        useUiStore.getState().setActiveSceneId('engine:game');
        useUiStore.getState().navigateToScreen('tech-tree');
        const snapshot = makeSnapshot();
        const { rerender } = render(wrap(snapshot, false));
        await screen.findByTestId('tech-tree-screen');
        const rendersAtRest = namedScreenRenders;

        rerender(wrap(snapshot, true));
        rerender(wrap(snapshot, false));

        expect(namedScreenRenders).toBe(rendersAtRest);
        expect(namedScreenMounts).toBe(1);
    });

    it('still re-renders the game screen when the snapshot advances', async () => {
        const { rerender } = render(wrap(makeSnapshot(), false));
        await screen.findByTestId('playfield-screen');
        const rendersAtRest = screenRenders;

        rerender(wrap(makeSnapshot({ tick: 4 }), false));

        expect(screenRenders).toBeGreaterThan(rendersAtRest);
        expect(screen.getByTestId('playfield-screen').getAttribute('data-tick')).toBe('4');
    });
});
